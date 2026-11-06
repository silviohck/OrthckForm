# OrthckForm

Web app (celular ou computador) que **lê a foto de uma ficha com o Claude** e **cadastra o paciente no Orthck** gerando o `dados.json` para importar no app do Mac ([Silvio-Monteiro](https://github.com/silviohck/Silvio-Monteiro)) ou do Windows ([silvio-monteiro-windows](https://github.com/silviohck/silvio-monteiro-windows)).

Feito para a ficha **Avaliação ortopédica – Araruna (CER II)**, mas lê outras fichas com os mesmos campos.

## Como usar

1. **Abra o `dados.json` atual do Orthck** (passo 1 do app).
   - Mac: `~/Library/Application Support/GeradorDocumentos/dados.json` (no Orthck: “Abrir pasta de dados”), ou o “Orthck - dados.json” do Google Drive.
   - Windows: `dados.json` da pasta de dados do Orthck.
2. **Fotografe a ficha** e clique em **Ler ficha com o Claude** (precisa de uma chave de API da Anthropic).
3. **Confira os campos.** Os de leitura duvidosa ficam em laranja; CPF com dígito verificador errado também.
   - Se o paciente já existe (mesmo CPF, mesmo CNS ou mesmo nome + nascimento), o app só **completa os campos vazios** do cadastro; o que já está lá não é trocado.
   - Se só o nome bate, você escolhe se é a mesma pessoa ou um novo paciente (como o Orthck faz com homônimos).
   - Escolha o **local de atendimento** (vem do dados.json; o app sugere o local pelo cabeçalho da ficha).
4. **Adicionar à lista**: repita para cada ficha.
5. **Baixar dados.json atualizado** e importar no Orthck:
   - **Mac:** barra lateral › *Importar dados (.json)…* › *Substituir todos os dados* (o Orthck guarda antes uma cópia em Backups).
   - **Windows:** *Importar dados (.json)…* › confirmar.

Importe logo depois de baixar: o que for cadastrado no Orthck entre abrir o dados.json aqui e importar se perde na substituição.

**Sem abrir o dados.json** o app baixa só os pacientes novos (`orthck-pacientes-AAAA-MM-DD.json`), para o Mac em *Importar dados › Juntar com os dados atuais*. Nesse modo não há verificação de paciente já cadastrado. **Não use esse arquivo no Windows**: lá a importação substitui todos os dados.

## O que vai para o cadastro

Os campos do paciente do Orthck: nome, nascimento, CPF, CNS, RG, telefone, e-mail, endereço, nº, bairro, cidade, UF, CEP e convênio, em MAIÚSCULAS como no Orthck. Datas saem em DD/MM/AAAA, CPF e CEP formatados.

O **atendimento** (Q.P., H.D.A., exame físico, exames, diagnóstico, CID, programação, perfil CER II) aparece para conferir e copiar, mas **não vai para o cadastro**: o Orthck não guarda anamnese no paciente. Opcionalmente, um resumo (data, diagnóstico e CID) pode ir para as observações.

## Leitura com o Claude

- Modelo `claude-opus-5-5` com saída estruturada (JSON Schema) e `fallbacks: "default"` para o caso de uma recusa.
- SDK oficial `@anthropic-ai/sdk` 1.0.0 empacotado em [`vendor/anthropic-sdk-1.0.0.mjs`](vendor/anthropic-sdk-1.0.0.mjs) (sem build nem CDN).
- A foto é reduzida para no máximo 2000 px (JPEG) e enviada **direto do navegador para a API da Anthropic**, só ao clicar em “Ler ficha”.
- A chave fica só na página, ou no `localStorage` do aparelho se marcar “Lembrar”. Use uma chave própria com limite de gastos. **Nunca coloque a chave no código**: o repositório é público.

## Privacidade

- Não há servidor: o `dados.json` é lido e gerado no navegador.
- A foto da ficha **contém dados de saúde** e vai para a Anthropic. Avalie a base legal na LGPD e o contrato de tratamento de dados antes de usar com pacientes reais.

## Publicar

GitHub Pages: **Settings → Pages → Deploy from a branch → main / (root)**. Endereço: https://silviohck.github.io/OrthckForm/ (precisa ser HTTPS ou `localhost` por causa do módulo JS).

Para testar localmente: `python3 -m http.server` na pasta e abrir http://localhost:8000 (abrir o `index.html` direto do disco não carrega o módulo).

## Atualizar o SDK

```bash
npm i @anthropic-ai/sdk@<versão> esbuild
echo 'export { default } from "@anthropic-ai/sdk";' > entry.mjs
npx esbuild entry.mjs --bundle --format=esm --platform=browser --minify --outfile=vendor/anthropic-sdk-<versão>.mjs
```

e trocar o `import` no início de `app.js`.
