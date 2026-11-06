(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const fieldNames = ["nome", "data", "cpf", "diagnostico", "cid", "observacoes"];
  const fieldLabels = {
    nome: "Nome completo",
    data: "Data",
    cpf: "CPF",
    diagnostico: "Diagnóstico",
    cid: "CID",
    observacoes: "Observações"
  };
  const defaults = {
    nome: { x: 10, y: 24, size: 12, lines: 2 },
    data: { x: 10, y: 35, size: 12, lines: 1 },
    cpf: { x: 59, y: 35, size: 12, lines: 1 },
    diagnostico: { x: 10, y: 47, size: 11, lines: 4 },
    cid: { x: 10, y: 59, size: 12, lines: 1 },
    observacoes: { x: 10, y: 72, size: 11, lines: 9 }
  };
  const state = {
    photo: null,
    photoURL: null,
    templateBytes: null,
    demoBytes: null,
    previewURL: null,
    busy: false
  };

  function status(id, message, tone) {
    const el = $(id);
    el.textContent = message;
    el.className = "status" + (tone ? " " + tone : "");
  }

  function setBusy(busy) {
    state.busy = busy;
    ["localOcrBtn", "aiOcrBtn", "generateBtn", "demoTemplateBtn", "extractBtn"]
      .forEach((id) => { $(id).disabled = busy; });
  }

  function textFields() {
    const data = {};
    fieldNames.forEach((key) => { data[key] = $( "field-" + key ).value.trim(); });
    return data;
  }

  function applyFields(data) {
    fieldNames.forEach((key) => {
      const incoming = data && data[key];
      if (typeof incoming === "string" || typeof incoming === "number") {
        $( "field-" + key ).value = String(incoming);
      }
    });
  }

  function autoExtract(text) {
    const results = {};
    const other = [];
    const rules = [
      ["nome", /^(?:nome(?:\s+completo)?|paciente)\s*[:\-=]\s*(.*)$/i],
      ["data", /^(?:data(?:\s+(?:da\s+)?consulta)?|dt\.?)\s*[:\-=]\s*(.*)$/i],
      ["cpf", /^cpf\s*[:\-=]\s*(.*)$/i],
      ["diagnostico", /^(?:diagn[oó]stico|diag\.?)\s*[:\-=]\s*(.*)$/i],
      ["cid", /^cid(?:\s*[- ]?\s*10)?\s*[:\-=]\s*(.*)$/i],
      ["observacoes", /^(?:observa[cç][oõ]es|obs\.?|anota[cç][oõ]es|descri[cç][aã]o)\s*[:\-=]\s*(.*)$/i]
    ];
    String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      .forEach((line) => {
        const rule = rules.find((item) => item[1].test(line));
        if (!rule) { other.push(line); return; }
        const value = line.match(rule[1])[1].trim();
        if (rule[0] === "observacoes") {
          results.observacoes = [results.observacoes, value].filter(Boolean).join("\n");
        } else {
          results[rule[0]] = value;
        }
      });
    if (other.length) {
      results.observacoes = [results.observacoes, other.join("\n")].filter(Boolean).join("\n");
    }
    return results;
  }

  function renderMappings() {
    $("mappingRows").innerHTML = fieldNames.map((key) => {
      const cfg = defaults[key];
      return '<tr><td><input type="checkbox" data-map-check="' + key + '" checked aria-label="Incluir ' + fieldLabels[key] + '"></td>' +
        '<td>' + fieldLabels[key] + '</td>' +
        '<td><input type="number" min="0" max="99" step="1" value="' + cfg.x + '" data-map-x="' + key + '" aria-label="X de ' + fieldLabels[key] + '"></td>' +
        '<td><input type="number" min="1" max="99" step="1" value="' + cfg.y + '" data-map-y="' + key + '" aria-label="Y de ' + fieldLabels[key] + '"></td>' +
        '<td><input type="number" min="7" max="22" step="1" value="' + cfg.size + '" data-map-size="' + key + '" aria-label="Fonte de ' + fieldLabels[key] + '"></td></tr>';
    }).join("");
  }

  function readMapping(key) {
    const get = (attr) => document.querySelector('[' + attr + '="' + key + '"]');
    const n = (attr, fallback, min, max) => {
      const value = Number(get(attr).value);
      return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
    };
    return {
      enabled: get("data-map-check").checked,
      x: n("data-map-x", defaults[key].x, 0, 99),
      y: n("data-map-y", defaults[key].y, 1, 99),
      size: n("data-map-size", defaults[key].size, 7, 22),
      lines: defaults[key].lines
    };
  }

  function choosePhoto(file) {
    if (!file) { return; }
    if (!file.type.startsWith("image/")) {
      status("ocrStatus", "Selecione uma imagem válida.", "error"); return;
    }
    if (file.size > 15 * 1024 * 1024) {
      status("ocrStatus", "A foto deve ter no máximo 15 MB.", "error"); return;
    }
    if (state.photoURL) { URL.revokeObjectURL(state.photoURL); }
    state.photo = file;
    state.photoURL = URL.createObjectURL(file);
    $("photoPreview").src = state.photoURL;
    $("photoFileName").textContent = file.name;
    $("photoPreviewWrap").classList.remove("hidden");
    status("ocrStatus", "Imagem selecionada. Escolha como reconhecer o texto.");
  }

  async function localOCR() {
    if (!state.photo) {
      status("ocrStatus", "Primeiro selecione uma fotografia.", "error"); return;
    }
    if (!window.Tesseract) {
      status("ocrStatus", "Biblioteca de OCR não carregada. Verifique a internet e recarregue a página.", "error"); return;
    }
    let worker;
    setBusy(true);
    status("ocrStatus", "Preparando reconhecimento local em português...");
    try {
      worker = await Tesseract.createWorker("por", 1, {
        logger: (event) => {
          if (event.status && typeof event.progress === "number") {
            status("ocrStatus", event.status + " — " + Math.round(event.progress * 100) + "%");
          }
        }
      });
      const result = await worker.recognize(state.photo);
      const text = result && result.data ? result.data.text.trim() : "";
      $("transcript").value = text;
      applyFields(autoExtract(text));
      status("ocrStatus", text ? "Texto reconhecido localmente. Revise os campos antes de gerar o PDF." :
        "Não foi possível ler texto. Tente uma foto mais nítida ou digite manualmente.", text ? "success" : "error");
      if (text) { $("review-title").scrollIntoView({ behavior: "smooth", block: "start" }); }
    } catch (err) {
      status("ocrStatus", "Falha no OCR local: " + (err.message || String(err)), "error");
    } finally {
      if (worker) { try { await worker.terminate(); } catch (_) {} }
      setBusy(false);
    }
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      reader.readAsDataURL(file);
    });
  }

  async function resizedDataURL(file) {
    const original = await readFileAsDataURL(file);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const factor = Math.min(1, 2200 / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * factor));
          canvas.height = Math.max(1, Math.round(img.height * factor));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", .88));
        } catch (_) { resolve(original); }
      };
      img.onerror = () => resolve(original);
      img.src = original;
    });
  }

  async function aiOCR() {
    if (!state.photo) {
      status("ocrStatus", "Primeiro selecione uma fotografia.", "error"); return;
    }
    const key = $("apiKey").value.trim();
    if (!key) {
      status("ocrStatus", "Informe sua chave de API para usar o reconhecimento avançado.", "error"); return;
    }
    const consent = window.confirm("Enviar esta imagem à API da OpenAI para reconhecimento de texto? Evite dados reais de pacientes sem as medidas de privacidade necessárias.");
    if (!consent) { return; }
    setBusy(true);
    status("ocrStatus", "Enviando a imagem para reconhecimento avançado...");
    try {
      const image = await resizedDataURL(state.photo);
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          max_tokens: 1800,
          messages: [
            {
              role: "system",
              content: "Você é um transcritor de documentos manuscritos em português. Nunca invente texto; para trechos ilegíveis use [ilegível]. Responda SOMENTE com JSON válido contendo transcricao (string) e campos (objeto com chaves nome,data,cpf,diagnostico,cid,observacoes; use strings vazias quando ausentes). Preserve grafia clínica e valores presentes. Não infira diagnósticos, nomes ou datas não visíveis."
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Transcreva fielmente esta imagem e extraia os campos explícitos. Mantenha o restante em observacoes." },
                { type: "image_url", image_url: { url: image, detail: "high" } }
              ]
            }
          ]
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = payload.error && payload.error.message ? payload.error.message : "Erro HTTP " + response.status;
        throw new Error(message);
      }
      const answer = payload.choices && payload.choices[0] && payload.choices[0].message && payload.choices[0].message.content;
      if (!answer) { throw new Error("A API não retornou uma transcrição."); }
      const parsed = JSON.parse(answer);
      const transcript = typeof parsed.transcricao === "string" ? parsed.transcricao : "";
      $("transcript").value = transcript;
      applyFields(Object.assign(autoExtract(transcript), parsed.campos || {}));
      status("ocrStatus", "Reconhecimento por IA concluído. Confira todos os campos.", "success");
      $("review-title").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      status("ocrStatus", "Falha no reconhecimento por IA: " + (err.message || String(err)) +
        ". Se houver bloqueio de rede/CORS, use o OCR local ou um backend protegido.", "error");
    } finally {
      $("apiKey").value = "";
      setBusy(false);
    }
  }

  function replacePreview(data) {
    if (state.previewURL) { URL.revokeObjectURL(state.previewURL); }
    state.previewURL = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
    $("pdfPreview").src = state.previewURL;
    $("pdfPreviewWrap").classList.remove("hidden");
  }

  async function makeDemoPDF() {
    if (state.demoBytes) { return state.demoBytes; }
    if (!window.PDFLib) { throw new Error("Biblioteca de PDF não disponível."); }
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const document = await PDFDocument.create();
    const page = document.addPage([595.28, 841.89]);
    const width = page.getWidth(), height = page.getHeight();
    const regular = await document.embedFont(StandardFonts.Helvetica);
    const bold = await document.embedFont(StandardFonts.HelveticaBold);
    page.drawRectangle({ x: 0, y: height - 115, width, height: 115, color: rgb(.07, .18, .28) });
    page.drawText("OrthckForm", { x: 57, y: height - 62, size: 24, font: bold, color: rgb(1, 1, 1) });
    page.drawText("MODELO DE DEMONSTRACAO", { x: 58, y: height - 83, size: 10, font: regular, color: rgb(.72, .91, .9) });
    page.drawText("FICHA DE REGISTRO", { x: 57, y: height - 151, size: 15, font: bold, color: rgb(.08, .23, .34) });

    const labels = [
      ["NOME COMPLETO", 10, 20, 76],
      ["DATA", 10, 31, 36],
      ["CPF", 59, 31, 31],
      ["DIAGNOSTICO", 10, 43, 78],
      ["CID", 10, 55, 36],
      ["OBSERVACOES", 10, 68, 78]
    ];
    labels.forEach(([label, x, y, widthPct]) => {
      const left = width * x / 100, top = height * y / 100;
      page.drawText(label, { x: left, y: height - top, size: 9, font: bold, color: rgb(.35, .47, .54) });
      page.drawLine({ start: { x: left, y: height - top - 46 }, end: { x: left + width * widthPct / 100, y: height - top - 46 }, thickness: .7, color: rgb(.76, .83, .85) });
    });
    page.drawText("Modelo ilustrativo. Revise todo o conteudo antes de utilizar.", {
      x: 57, y: 36, size: 9, font: regular, color: rgb(.45, .54, .58)
    });
    state.demoBytes = await document.save();
    return state.demoBytes;
  }

  async function useDemo() {
    try {
      state.templateBytes = null;
      $("pdfInput").value = "";
      $("pageNumber").value = "1";
      $("pageNumber").max = "1";
      replacePreview(await makeDemoPDF());
      $("pdfFileName").textContent = "Modelo de demonstração (A4) selecionado.";
      status("pdfStatus", "");
    } catch (err) {
      status("pdfStatus", err.message || String(err), "error");
    }
  }

  async function uploadTemplate(file) {
    if (!file) { return; }
    try {
      if (file.size > 20 * 1024 * 1024) { throw new Error("O PDF deve ter até 20 MB."); }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await PDFLib.PDFDocument.load(bytes.slice(), { ignoreEncryption: false });
      const count = doc.getPageCount();
      if (!count) { throw new Error("Este arquivo não contém páginas."); }
      state.templateBytes = bytes;
      $("pageNumber").max = String(count);
      $("pageNumber").value = "1";
      $("pdfFileName").textContent = file.name + " • " + count + (count === 1 ? " página" : " páginas");
      replacePreview(bytes);
      status("pdfStatus", "Modelo carregado. Ajuste as coordenadas dos campos antes de gerar.");
    } catch (err) {
      $("pdfInput").value = "";
      status("pdfStatus", "Não foi possível abrir o PDF: " + (err.message || String(err)), "error");
    }
  }

  function normalize(value) {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  const aliases = {
    nome: ["nome", "nomecompleto", "paciente", "nomedopaciente"],
    data: ["data", "datadaconsulta", "dataatendimento"],
    cpf: ["cpf", "cpfdompaciente", "cpfpaciente"],
    diagnostico: ["diagnostico", "diagnosticoprincipal"],
    cid: ["cid", "cid10"],
    observacoes: ["observacoes", "observacao", "anotacoes", "descricao"]
  };

  function safeLatin(text) {
    return String(text).replace(/\r/g, "").replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF\u20AC\u2018-\u201D\u2022]/g, "?");
  }

  function wrapText(value, font, size, maxWidth, limit) {
    const lines = [];
    safeLatin(value).split("\n").forEach((paragraph) => {
      let current = "";
      paragraph.split(/\s+/).filter(Boolean).forEach((word) => {
        const candidate = current ? current + " " + word : word;
        if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
          current = candidate;
        } else {
          if (current) { lines.push(current); current = ""; }
          if (font.widthOfTextAtSize(word, size) <= maxWidth) {
            current = word;
          } else {
            let part = "";
            for (const char of word) {
              if (font.widthOfTextAtSize(part + char, size) > maxWidth && part) {
                lines.push(part); part = "";
              }
              part += char;
            }
            current = part;
          }
        }
      });
      if (current) { lines.push(current); }
    });
    return lines.slice(0, limit);
  }

  async function generate() {
    if (!window.PDFLib) {
      status("pdfStatus", "Biblioteca de PDF indisponível. Recarregue a página.", "error"); return;
    }
    const values = textFields();
    if (!Object.values(values).some(Boolean)) {
      status("pdfStatus", "Preencha ou reconheça pelo menos um campo.", "error"); return;
    }
    setBusy(true);
    status("pdfStatus", "Gerando documento...");
    try {
      const source = state.templateBytes || await makeDemoPDF();
      const document = await PDFLib.PDFDocument.load(source.slice());
      const regular = await document.embedFont(PDFLib.StandardFonts.Helvetica);
      const requestedPage = Number($("pageNumber").value);
      const pageIndex = Number.isFinite(requestedPage) ? Math.max(0, Math.min(document.getPageCount() - 1, requestedPage - 1)) : 0;
      const page = document.getPage(pageIndex);
      const filledNative = new Set();

      try {
        const form = document.getForm();
        form.getFields().forEach((field) => {
          if (!(field instanceof PDFLib.PDFTextField)) { return; }
          const key = fieldNames.find((name) => aliases[name].includes(normalize(field.getName())));
          if (key && values[key] && readMapping(key).enabled) {
            try {
              field.setText(safeLatin(values[key]));
              filledNative.add(key);
            } catch (_) { /* fallback to visual overlay */ }
          }
        });
        if (filledNative.size) {
          try { form.updateFieldAppearances(regular); } catch (_) { /* keep existing appearance */ }
        }
      } catch (_) { /* PDFs may not contain AcroForm fields */ }

      const width = page.getWidth(), height = page.getHeight();
      fieldNames.forEach((key) => {
        const value = values[key];
        const m = readMapping(key);
        if (!value || !m.enabled || filledNative.has(key)) { return; }
        const x = m.x * width / 100;
        const y = height - m.y * height / 100;
        const maxWidth = Math.max(24, width - x - width * .06);
        const lines = wrapText(value, regular, m.size, maxWidth, m.lines);
        lines.forEach((line, i) => {
          page.drawText(line, { x, y: y - i * m.size * 1.4, size: m.size,
            color: PDFLib.rgb(.08, .15, .22), font: regular });
        });
      });

      const output = await document.save();
      replacePreview(output);
      const blob = new Blob([output], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const name = normalize(values.nome).slice(0, 35) || "documento";
      link.href = url;
      link.download = "OrthckForm-" + name + ".pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      status("pdfStatus", "PDF gerado e download iniciado. Confira o resultado.", "success");
    } catch (err) {
      status("pdfStatus", "Falha ao gerar o PDF: " + (err.message || String(err)), "error");
    } finally {
      setBusy(false);
    }
  }

  function init() {
    renderMappings();
    $("photoInput").addEventListener("change", (event) => choosePhoto(event.target.files[0]));
    $("localOcrBtn").addEventListener("click", localOCR);
    $("aiOcrBtn").addEventListener("click", aiOCR);
    $("extractBtn").addEventListener("click", () => {
      applyFields(autoExtract($("transcript").value));
      status("ocrStatus", "Campos extraídos. Confira os resultados.", "success");
    });
    $("demoTemplateBtn").addEventListener("click", useDemo);
    $("pdfInput").addEventListener("change", (event) => uploadTemplate(event.target.files[0]));
    $("generateBtn").addEventListener("click", generate);
    useDemo();
    window.addEventListener("beforeunload", () => {
      if (state.photoURL) { URL.revokeObjectURL(state.photoURL); }
      if (state.previewURL) { URL.revokeObjectURL(state.previewURL); }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
