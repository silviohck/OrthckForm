import Anthropic from "./vendor/anthropic-sdk-1.0.0.mjs";

const $ = (id) => document.getElementById(id);
const MODEL = "claude-opus-5-5";
const KEY_STORAGE = "orthckform.anthropicKey";

// Campos do cadastro do Orthck (Paciente em Modelos.swift / Modelos.cs). As chaves são as do dados.json.
const PATIENT_FIELDS = [
  ["nome", "Nome completo", "full"],
  ["dataNascimento", "Data de nascimento", "", "DD/MM/AAAA"],
  ["cpf", "CPF", "", "000.000.000-00"],
  ["cns", "CNS (cartão do SUS)", ""],
  ["rg", "RG", ""],
  ["telefone", "Telefone", ""],
  ["email", "E-mail", ""],
  ["endereco", "Endereço", "full"],
  ["numero", "Nº", ""],
  ["bairro", "Bairro", ""],
  ["cidade", "Cidade", ""],
  ["uf", "UF", ""],
  ["cep", "CEP", ""],
  ["convenio", "Convênio", ""]
];
const PATIENT_KEYS = PATIENT_FIELDS.map((f) => f[0]);

// Campos do atendimento (ficha Avaliação ortopédica – Araruna, CER II). Valem só para o prontuário.
const CLINICAL_FIELDS = [
  ["dataAvaliacao", "Data da avaliação", ""],
  ["cid", "CID-10", ""],
  ["queixaPrincipal", "Queixa principal (Q.P.)", "full"],
  ["hda", "H.D.A.", "full", "", 4],
  ["exameFisico", "Exame físico", "full", "", 4],
  ["examesComplementares", "Exames complementares", "full", "", 2],
  ["diagnostico", "Diagnóstico", "full"],
  ["programacaoTerapeutica", "Programação terapêutica", "full", "", 3],
  ["perfilCerII", "Perfil CER II", "full"]
];
const CLINICAL_KEYS = CLINICAL_FIELDS.map((f) => f[0]);

const state = {
  photo: null,
  photoURL: null,
  busy: false,
  dados: null,        // dados.json aberto (objeto completo, preservado)
  dadosName: "",
  queue: [],          // { tipo: "novo" | "atualizar", paciente, alvoId?, resumo }
  matchChoice: null   // id do paciente escolhido, "novo" ou null
};

// MARK: Utilidades

function status(id, message, tone) {
  const el = $(id);
  el.textContent = message || "";
  el.className = "status" + (tone ? " " + tone : "");
}

function setBusy(busy) {
  state.busy = busy;
  ["readBtn", "addBtn", "downloadBtn"].forEach((id) => { $(id).disabled = busy; });
  if (!busy) { $("downloadBtn").disabled = state.queue.length === 0; }
}

function newUUID() {
  const id = (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
  return id.toUpperCase(); // como o Swift grava
}

function normalizeName(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/\s+/g, " ").trim();
}

const digits = (value) => String(value || "").replace(/\D/g, "");

function sameId(a, b) {
  return String(a || "").toUpperCase() === String(b || "").toUpperCase();
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function safeStorage(action) {
  try { return action(window.localStorage); } catch (_) { return null; }
}

// O Orthck guarda nome e campos em MAIÚSCULAS (menos o e-mail).
function cleanPatientValue(key, value) {
  const text = String(value || "").replace(/\s+\n/g, "\n").trim();
  if (key === "email") { return text.toLowerCase(); }
  return text.toUpperCase();
}

function formatDate(value) {
  const m = String(value || "").trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/);
  if (!m) { return String(value || "").trim(); }
  let year = m[3];
  if (year.length === 2) {
    const now = new Date().getFullYear() % 100;
    year = (Number(year) > now ? "19" : "20") + year;
  }
  return m[1].padStart(2, "0") + "/" + m[2].padStart(2, "0") + "/" + year;
}

function formatCPF(value) {
  const d = digits(value);
  return d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : String(value || "").trim();
}

function formatCEP(value) {
  const d = digits(value);
  return d.length === 8 ? d.replace(/(\d{5})(\d{3})/, "$1-$2") : String(value || "").trim();
}

function validCPF(value) {
  const d = digits(value);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) { return false; }
  const check = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) { sum += Number(d[i]) * (len + 1 - i); }
    const r = (sum * 10) % 11;
    return (r === 10 ? 0 : r) === Number(d[len]);
  };
  return check(9) && check(10);
}

// MARK: Formulário

function renderFields(containerId, fields, prefix) {
  $(containerId).innerHTML = fields.map(([key, label, cls, placeholder, rows]) => {
    const id = prefix + key;
    const control = rows
      ? '<textarea id="' + id + '" rows="' + rows + '"></textarea>'
      : '<input id="' + id + '" type="text"' + (placeholder ? ' placeholder="' + placeholder + '"' : "") + ">";
    return '<label class="' + (cls || "") + '" for="' + id + '">' + label + control + "</label>";
  }).join("");
}

function readPatient() {
  const p = {};
  PATIENT_KEYS.forEach((key) => { p[key] = cleanPatientValue(key, $("p-" + key).value); });
  p.dataNascimento = formatDate(p.dataNascimento);
  p.cpf = formatCPF(p.cpf);
  p.cep = formatCEP(p.cep);
  p.cns = digits(p.cns).length === 15 ? digits(p.cns) : p.cns;
  return p;
}

function readClinical() {
  const c = {};
  CLINICAL_KEYS.forEach((key) => { c[key] = $("c-" + key).value.trim(); });
  return c;
}

function markDoubts(doubts) {
  const set = new Set(doubts || []);
  PATIENT_KEYS.forEach((k) => $("p-" + k).classList.toggle("doubt", set.has(k)));
  CLINICAL_KEYS.forEach((k) => $("c-" + k).classList.toggle("doubt", set.has(k)));
}

function fillForm(result) {
  const p = result.paciente || {};
  PATIENT_KEYS.forEach((key) => { $("p-" + key).value = cleanPatientValue(key, p[key]); });
  $("p-dataNascimento").value = formatDate($("p-dataNascimento").value);
  $("p-cpf").value = formatCPF($("p-cpf").value);
  $("p-cep").value = formatCEP($("p-cep").value);
  const c = result.atendimento || {};
  CLINICAL_KEYS.forEach((key) => { $("c-" + key).value = String(c[key] || "").trim(); });
  $("transcript").value = result.transcricao || "";
  const doubts = (result.duvidas || []).slice();
  if ($("p-cpf").value && !validCPF($("p-cpf").value)) { doubts.push("cpf"); }
  markDoubts(doubts);
  if (CLINICAL_KEYS.some((k) => c[k])) { $("atendimentoDetails").open = true; }
  guessLocal(result.local || "");
  state.matchChoice = null;
  updateMatches();
}

function clearForm() {
  PATIENT_KEYS.forEach((k) => { $("p-" + k).value = ""; });
  CLINICAL_KEYS.forEach((k) => { $("c-" + k).value = ""; });
  $("transcript").value = "";
  $("appendObs").checked = false;
  markDoubts([]);
  state.matchChoice = null;
  updateMatches();
}

// MARK: dados.json

const pacientesDoArquivo = () => (state.dados && Array.isArray(state.dados.pacientes) ? state.dados.pacientes : []);
const locaisDoArquivo = () => (state.dados && Array.isArray(state.dados.locais) ? state.dados.locais : []);

async function openDados(file) {
  if (!file) { return; }
  try {
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        (!Array.isArray(parsed.pacientes) && !Array.isArray(parsed.locais))) {
      throw new Error("este arquivo não parece ser um dados.json do Orthck");
    }
    if (state.queue.length && !window.confirm("Trocar o arquivo de dados descarta a lista de pacientes ainda não baixada. Continuar?")) {
      $("dadosInput").value = ""; return;
    }
    state.dados = parsed;
    state.dadosName = file.name;
    state.queue = [];
    renderQueue();
    renderLocais();
    updateMatches();
    $("dadosInfo").textContent = file.name + " • " + pacientesDoArquivo().length + " pacientes, " +
      locaisDoArquivo().length + " locais de atendimento.";
    $("dadosInfo").className = "hint success";
  } catch (err) {
    $("dadosInput").value = "";
    $("dadosInfo").textContent = "Não foi possível abrir: " + (err.message || String(err)) + ".";
    $("dadosInfo").className = "hint error";
  }
}

function renderLocais() {
  const locais = locaisDoArquivo().slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  const previous = $("localSelect").value || safeStorage((s) => s.getItem("orthckform.local")) || "";
  $("localSelect").innerHTML = '<option value="">Nenhum</option>' + locais.map((l) =>
    '<option value="' + escapeHTML(l.id) + '">' + escapeHTML(l.nome || "Local sem nome") + "</option>").join("");
  if (locais.some((l) => sameId(l.id, previous))) { $("localSelect").value = locais.find((l) => sameId(l.id, previous)).id; }
  $("localSelectWrap").classList.toggle("hidden", !state.dados);
  $("localNameWrap").classList.toggle("hidden", !!state.dados);
  renderHowto();
}

// A ficha costuma trazer o nome do serviço (ex.: “Araruna”): sugere o local de mesmo nome se nenhum foi escolhido.
function guessLocal(hint) {
  if (!state.dados || $("localSelect").value) { return; }
  const words = normalizeName(hint).split(" ").filter((w) => w.length > 3);
  const local = locaisDoArquivo().find((l) => words.some((w) => normalizeName(l.nome).includes(w)));
  if (local) { $("localSelect").value = local.id; }
}

function chosenLocal() {
  if (state.dados) {
    const id = $("localSelect").value;
    return id ? locaisDoArquivo().find((l) => sameId(l.id, id)) || null : null;
  }
  const nome = $("localName").value.trim().toUpperCase();
  return nome ? { nome } : null;
}

// MARK: Paciente já cadastrado?

function candidates(p) {
  const list = pacientesDoArquivo().map((x) => ({ paciente: x, origem: "cadastro" }))
    .concat(state.queue.filter((q) => q.tipo === "novo").map((q) => ({ paciente: q.paciente, origem: "lista" })));
  const nome = normalizeName(p.nome);
  const cpf = digits(p.cpf), cns = digits(p.cns);
  const out = [];
  list.forEach((item) => {
    const x = item.paciente;
    const sameCPF = cpf.length === 11 && digits(x.cpf) === cpf;
    const sameCNS = cns.length === 15 && digits(x.cns) === cns;
    const sameName = nome && normalizeName(x.nome) === nome;
    const sameDN = p.dataNascimento && formatDate(x.dataNascimento) === p.dataNascimento;
    if (sameCPF || sameCNS || (sameName && sameDN)) {
      out.push({ ...item, forte: true, motivo: sameCPF ? "mesmo CPF" : sameCNS ? "mesmo CNS" : "mesmo nome e nascimento" });
    } else if (sameName) {
      out.push({ ...item, forte: false, motivo: "mesmo nome" });
    }
  });
  return out;
}

function describe(x) {
  const parts = [];
  if (x.dataNascimento) { parts.push("nasc. " + x.dataNascimento); }
  if (x.cpf) { parts.push("CPF " + x.cpf); }
  if (x.cns) { parts.push("CNS " + x.cns); }
  return parts.join(" · ") || "sem nascimento/CPF";
}

function updateMatches() {
  const box = $("matchBox");
  const p = readPatient();
  const found = p.nome ? candidates(p) : [];
  if (!found.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    state.matchChoice = "novo";
    return;
  }
  const strong = found.find((f) => f.forte);
  const valid = found.some((f) => sameId(f.paciente.id, state.matchChoice)) || state.matchChoice === "novo";
  if (!valid) { state.matchChoice = strong ? strong.paciente.id : null; }
  box.classList.remove("hidden");
  box.innerHTML = '<h3 id="matchTitle">' + (strong ? "Este paciente já parece estar cadastrado" : "Há paciente com o mesmo nome") + "</h3>" +
    '<p class="hint">' + (strong
      ? "Os campos vazios do cadastro serão completados com os da ficha; o que já está no cadastro não é trocado."
      : "Escolha se é a mesma pessoa ou outro paciente (o Orthck também não escolhe sozinho entre homônimos).") + "</p>" +
    found.map((f) => '<label class="check"><input type="radio" name="match" value="' + escapeHTML(f.paciente.id) + '"' +
      (sameId(f.paciente.id, state.matchChoice) ? " checked" : "") + "> <span><strong>" + escapeHTML(f.paciente.nome) + "</strong> — " +
      escapeHTML(describe(f.paciente)) + ' <em>(' + f.motivo + (f.origem === "lista" ? ", já na lista" : "") + ")</em></span></label>").join("") +
    '<label class="check"><input type="radio" name="match" value="novo"' + (state.matchChoice === "novo" ? " checked" : "") +
    "> <span>É outro paciente: cadastrar como novo</span></label>";
  box.querySelectorAll('input[name="match"]').forEach((r) => r.addEventListener("change", () => { state.matchChoice = r.value; }));
}

// MARK: Leitura com o Claude

const str = { type: "string" };
const RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["paciente", "atendimento", "local", "duvidas", "transcricao"],
  properties: {
    paciente: {
      type: "object", additionalProperties: false, required: PATIENT_KEYS,
      properties: Object.fromEntries(PATIENT_KEYS.map((k) => [k, str]))
    },
    atendimento: {
      type: "object", additionalProperties: false, required: CLINICAL_KEYS,
      properties: Object.fromEntries(CLINICAL_KEYS.map((k) => [k, str]))
    },
    local: str,
    duvidas: { type: "array", items: { type: "string", enum: PATIENT_KEYS.concat(CLINICAL_KEYS) } },
    transcricao: str
  }
};

const SYSTEM_PROMPT = [
  "Você transcreve fichas médicas em português (muitas preenchidas à mão) para cadastrar pacientes no Orthck, um app de consultório de ortopedia.",
  "A ficha mais comum é a “Avaliação ortopédica” do CER II de Araruna (PB): 1. Identificação (Nome, D/N, Endereço, nº, CPF, Bairro, Cidade, UF, CEP, Diagnóstico, Data da Avaliação, Tel, CNS), 2. Q.P., 3. H.D.A., 4. Exame físico, 5. Programação terapêutica, CID 10 e Perfil CER II. Outras fichas também podem aparecer: use os mesmos campos.",
  "Regras:",
  "- Transcreva só o que está escrito. Nunca invente nem complete nomes, números ou datas. Campo em branco ou ausente: string vazia.",
  "- Trecho que você não consegue ler: escreva [ilegível] no lugar e inclua a chave do campo em duvidas. Inclua também em duvidas qualquer campo em que você hesitou entre leituras (ex.: um dígito do CPF).",
  "- Os campos impressos do formulário (rótulos como “Nome:”) não são valores.",
  "- Datas no formato DD/MM/AAAA quando estiverem completas; se o ano estiver com 2 dígitos, mantenha como escrito.",
  "- CPF, CNS, CEP e telefone: só os dígitos que estão na ficha, sem adivinhar os que faltam.",
  "- local: nome do serviço/cidade impresso no cabeçalho da ficha (ex.: “Araruna CER II”), ou vazio.",
  "- examesComplementares: exames citados (RX, RM, USG…) quando estiverem separados; se estiverem dentro do exame físico, deixe-os lá.",
  "- transcricao: todo o texto escrito à mão na ficha, na ordem em que aparece, com quebras de linha."
].join("\n");

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("não foi possível ler a imagem"));
    reader.readAsDataURL(file);
  });
}

// Reduz a foto para no máximo 2000 px e JPEG (fica bem abaixo do limite de 5 MB por imagem da API).
async function photoAsJPEG(file) {
  const original = await readFileAsDataURL(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("formato de imagem não suportado pelo navegador (tente JPG ou PNG)"));
    i.src = original;
  });
  const factor = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * factor));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * factor));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
}

function choosePhoto(file) {
  if (!file) { return; }
  if (!file.type.startsWith("image/")) { status("readStatus", "Escolha uma imagem.", "error"); return; }
  if (file.size > 20 * 1024 * 1024) { status("readStatus", "A foto deve ter no máximo 20 MB.", "error"); return; }
  if (state.photoURL) { URL.revokeObjectURL(state.photoURL); }
  state.photo = file;
  state.photoURL = URL.createObjectURL(file);
  $("photoPreview").src = state.photoURL;
  $("photoFileName").textContent = file.name;
  $("photoPreviewWrap").classList.remove("hidden");
  status("readStatus", "Foto pronta. Clique em “Ler ficha com o Claude”.");
}

async function readForm() {
  if (!state.photo) { status("readStatus", "Primeiro escolha a foto da ficha.", "error"); return; }
  const apiKey = $("apiKey").value.trim();
  if (!apiKey) { status("readStatus", "Informe a chave de API da Anthropic.", "error"); return; }
  if ($("rememberKey").checked) { safeStorage((s) => s.setItem(KEY_STORAGE, apiKey)); } else { safeStorage((s) => s.removeItem(KEY_STORAGE)); }

  setBusy(true);
  status("readStatus", "Lendo a ficha… isso pode levar até um minuto.");
  try {
    const image = await photoAsJPEG(state.photo);
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: { type: "json_schema", schema: RESULT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: "Transcreva esta ficha e preencha os campos." }
        ]
      }]
    });
    if (response.stop_reason === "refusal") {
      throw new Error("o modelo recusou esta imagem" + (response.stop_details && response.stop_details.explanation ? " (" + response.stop_details.explanation + ")" : ""));
    }
    if (response.stop_reason === "max_tokens") { throw new Error("a resposta ficou incompleta; tente de novo"); }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const result = JSON.parse(text);
    fillForm(result);
    const doubts = document.querySelectorAll(".doubt").length;
    status("readStatus", "Ficha lida. " + (doubts ? doubts + " campo(s) com leitura duvidosa, em laranja. " : "") + "Confira antes de adicionar.", "success");
    $("review-title").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    status("readStatus", "Falha ao ler a ficha: " + explainError(err), "error");
  } finally {
    setBusy(false);
  }
}

function explainError(err) {
  if (err instanceof Anthropic.AuthenticationError) { return "chave de API inválida."; }
  if (err instanceof Anthropic.PermissionDeniedError) { return "esta chave não tem permissão para usar o modelo."; }
  if (err instanceof Anthropic.RateLimitError) { return "limite de uso atingido; aguarde um pouco e tente de novo."; }
  if (err instanceof Anthropic.BadRequestError) { return "pedido recusado pela API (" + err.message + ")."; }
  if (err instanceof Anthropic.APIConnectionError) { return "sem conexão com a API da Anthropic. Verifique a internet."; }
  if (err instanceof Anthropic.APIError) { return "erro da API (" + (err.status || "") + "): " + err.message; }
  if (err instanceof SyntaxError) { return "a resposta não veio no formato esperado; tente de novo."; }
  return err && err.message ? err.message : String(err);
}

// MARK: Lista e exportação

function clinicalSummary(c) {
  const parts = [];
  if (c.dataAvaliacao) { parts.push("AVALIAÇÃO " + c.dataAvaliacao.toUpperCase()); }
  if (c.diagnostico) { parts.push("DIAGNÓSTICO: " + c.diagnostico.toUpperCase()); }
  if (c.cid) { parts.push("CID " + c.cid.toUpperCase()); }
  return parts.join(" · ");
}

function addToQueue() {
  const p = readPatient();
  if (!p.nome) { status("addStatus", "Preencha o nome do paciente.", "error"); $("p-nome").focus(); return; }
  updateMatches();
  if (state.matchChoice === null) { status("addStatus", "Escolha acima se é o mesmo paciente ou outro.", "error"); return; }
  if (p.cpf && !validCPF(p.cpf) && !window.confirm("O CPF " + p.cpf + " não é válido (dígitos verificadores). Adicionar mesmo assim?")) { return; }
  if (p.dataNascimento && !/^\d{2}\/\d{2}\/\d{4}$/.test(p.dataNascimento) &&
      !window.confirm("A data de nascimento “" + p.dataNascimento + "” não está no formato DD/MM/AAAA (o Orthck usa esse formato para calcular a idade). Adicionar mesmo assim?")) { return; }

  const local = chosenLocal();
  if (local && state.dados) { safeStorage((s) => s.setItem("orthckform.local", local.id)); }
  const extra = $("appendObs").checked ? clinicalSummary(readClinical()) : "";
  const choice = state.matchChoice;

  if (choice !== "novo") {
    const inQueue = state.queue.find((q) => q.tipo === "novo" && sameId(q.paciente.id, choice));
    const alvo = inQueue ? inQueue.paciente : pacientesDoArquivo().find((x) => sameId(x.id, choice));
    if (!alvo) { status("addStatus", "Paciente escolhido não encontrado.", "error"); return; }
    const completed = [], kept = [];
    const campos = {};
    PATIENT_KEYS.forEach((key) => {
      if (key === "nome" || !p[key]) { return; }
      const atual = String(alvo[key] || "").trim();
      if (!atual) { campos[key] = p[key]; completed.push(key); } else if (normalizeName(atual) !== normalizeName(p[key])) { kept.push(key); }
    });
    if (extra) { campos.observacoes = [String(alvo.observacoes || "").trim(), extra].filter(Boolean).join("\n"); }
    if (inQueue) {
      Object.assign(inQueue.paciente, campos);
      inQueue.resumo = "Novo (completado com outra foto)";
    } else {
      state.queue.push({ tipo: "atualizar", alvoId: alvo.id, paciente: { nome: alvo.nome }, campos, local,
        resumo: completed.length ? "Completar: " + completed.map(labelOf).join(", ") : "Já cadastrado, nada a completar" });
    }
    status("addStatus", alvo.nome + ": " + (completed.length ? completed.length + " campo(s) a completar." : "nada novo para o cadastro.") +
      (kept.length ? " Diferente no cadastro (mantido): " + kept.map(labelOf).join(", ") + "." : ""), kept.length ? "" : "success");
  } else {
    const paciente = { id: newUUID() };
    PATIENT_KEYS.forEach((key) => { paciente[key] = p[key]; });
    paciente.observacoes = extra;
    state.queue.push({ tipo: "novo", paciente, local, resumo: "Novo paciente" });
    status("addStatus", p.nome + " adicionado à lista.", "success");
  }
  renderQueue();
  clearForm();
  state.photo = null;
  $("photoInput").value = "";
  $("photoPreviewWrap").classList.add("hidden");
}

function labelOf(key) {
  const f = PATIENT_FIELDS.find((x) => x[0] === key);
  return f ? f[1] : key;
}

function renderQueue() {
  const list = $("queueList");
  if (!state.queue.length) {
    list.innerHTML = '<li class="empty">Nenhum paciente na lista.</li>';
  } else {
    list.innerHTML = state.queue.map((q, i) => "<li><div><strong>" + escapeHTML(q.paciente.nome) + "</strong><small>" +
      escapeHTML(q.resumo + (q.local ? " · " + (q.local.nome || "") : "") + (q.tipo === "novo" ? " · " + describe(q.paciente) : "")) +
      '</small></div><button type="button" class="text-button" data-remove="' + i + '">Remover</button></li>').join("");
    list.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
      state.queue.splice(Number(b.dataset.remove), 1);
      renderQueue();
      updateMatches();
    }));
  }
  $("downloadBtn").disabled = state.busy || !state.queue.length;
  renderHowto();
}

function renderHowto() {
  const n = state.queue.length;
  $("downloadBtn").textContent = state.dados ? "Baixar dados.json atualizado" + (n ? " (" + n + ")" : "") : "Baixar arquivo para juntar (só Mac)" + (n ? " (" + n + ")" : "");
  $("howto").innerHTML = state.dados
    ? "<h3>Depois de baixar</h3><ol>" +
      "<li><strong>Mac:</strong> Orthck › barra lateral › <em>Importar dados (.json)…</em> › escolha o arquivo baixado › <em>Substituir todos os dados</em>. (Antes, o Orthck guarda uma cópia dos dados atuais em Backups.)</li>" +
      "<li><strong>Windows:</strong> <em>Importar dados (.json)…</em> › escolha o arquivo baixado › confirme.</li>" +
      "<li>Use o arquivo logo depois de baixar: o que for cadastrado no Orthck entre abrir o dados.json aqui e importar será perdido na substituição.</li></ol>"
    : "<h3>Sem o dados.json aberto</h3><p class=\"hint\">O arquivo baixado tem só os pacientes novos. No <strong>Mac</strong>: <em>Importar dados (.json)…</em> › <em>Juntar com os dados atuais</em> (pacientes já cadastrados não são completados e homônimos não são verificados). <strong>Não use no Windows</strong>: lá a importação substitui todos os dados. Para o Windows, abra o dados.json no passo 1.</p>";
}

function buildOutput() {
  if (state.dados) {
    const out = JSON.parse(JSON.stringify(state.dados));
    out.pacientes = Array.isArray(out.pacientes) ? out.pacientes : [];
    state.queue.forEach((q) => {
      if (q.tipo === "novo") {
        const paciente = { ...q.paciente };
        if (q.local && q.local.id) { paciente.localID = q.local.id; }
        out.pacientes.push(paciente);
      } else {
        const alvo = out.pacientes.find((x) => sameId(x.id, q.alvoId));
        if (!alvo) { return; }
        Object.assign(alvo, q.campos);
        if (q.local && q.local.id && !alvo.localID) { alvo.localID = q.local.id; }
      }
    });
    return { name: "dados.json", data: out };
  }
  // Sem o arquivo: só os pacientes novos, para “Juntar com os dados atuais” no Mac.
  const locais = [];
  const pacientes = state.queue.filter((q) => q.tipo === "novo").map((q) => {
    const paciente = { ...q.paciente };
    if (q.local) {
      let local = locais.find((l) => normalizeName(l.nome) === normalizeName(q.local.nome));
      if (!local) { local = { id: newUUID(), nome: q.local.nome }; locais.push(local); }
      paciente.localID = local.id; // o Orthck reaproveita o local de mesmo nome ao juntar
    }
    return paciente;
  });
  const hoje = new Date().toISOString().slice(0, 10);
  return { name: "orthck-pacientes-" + hoje + ".json", data: { pacientes, locais } };
}

function download() {
  if (!state.queue.length) { return; }
  const { name, data } = buildOutput();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  const count = state.queue.length;
  if (state.dados) {
    // O arquivo baixado passa a ser o dado atual: dá para continuar cadastrando e baixar de novo.
    state.dados = data;
    $("dadosInfo").textContent = name + " (atualizado aqui) • " + pacientesDoArquivo().length + " pacientes, " + locaisDoArquivo().length + " locais.";
  }
  state.queue = [];
  renderQueue();
  status("downloadStatus", name + " baixado com " + count + " paciente(s). Agora importe no Orthck.", "success");
}

async function copyClinical() {
  const c = readClinical();
  const text = CLINICAL_FIELDS.filter(([k]) => c[k]).map(([k, label]) => label + ": " + c[k]).join("\n");
  if (!text) { return; }
  try { await navigator.clipboard.writeText(text); $("copyClinicalBtn").textContent = "Copiado!"; } catch (_) { $("copyClinicalBtn").textContent = "Não foi possível copiar"; }
  setTimeout(() => { $("copyClinicalBtn").textContent = "Copiar atendimento"; }, 2000);
}

// MARK: Início

function init() {
  renderFields("patientFields", PATIENT_FIELDS, "p-");
  renderFields("clinicalFields", CLINICAL_FIELDS, "c-");
  renderLocais();
  renderQueue();
  const saved = safeStorage((s) => s.getItem(KEY_STORAGE));
  if (saved) { $("apiKey").value = saved; $("rememberKey").checked = true; }
  $("rememberKey").addEventListener("change", () => { if (!$("rememberKey").checked) { safeStorage((s) => s.removeItem(KEY_STORAGE)); } });
  $("dadosInput").addEventListener("change", (e) => openDados(e.target.files[0]));
  $("photoInput").addEventListener("change", (e) => choosePhoto(e.target.files[0]));
  $("readBtn").addEventListener("click", readForm);
  $("addBtn").addEventListener("click", addToQueue);
  $("clearBtn").addEventListener("click", () => { clearForm(); status("addStatus", ""); });
  $("downloadBtn").addEventListener("click", download);
  $("copyClinicalBtn").addEventListener("click", copyClinical);
  ["p-nome", "p-cpf", "p-cns", "p-dataNascimento"].forEach((id) => $(id).addEventListener("change", updateMatches));
  document.querySelectorAll("#patientFields input, #clinicalFields input, #clinicalFields textarea").forEach((el) =>
    el.addEventListener("input", () => el.classList.remove("doubt")));
  window.addEventListener("beforeunload", (e) => {
    if (state.queue.length) { e.preventDefault(); e.returnValue = ""; }
  });
}

init();
