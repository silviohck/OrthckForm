# OrthckForm

Web app responsivo para transformar uma **foto de texto manuscrito** em um **PDF preenchido**, com etapa de conferência.

## Funcionalidades

- Envio de foto a partir do celular ou computador (JPG, PNG, WebP).
- OCR local em português com [Tesseract.js](https://tesseract.projectnaptha.com/) — gratuito e processado no navegador; tem limitações importantes com escrita cursiva.
- Reconhecimento avançado **opcional**, mediante chave de API do próprio usuário, usando o modelo de visão da OpenAI.
- Revisão da transcrição e dos campos: nome, data, CPF, diagnóstico, CID e observações.
- Carregamento de PDF próprio, com coordenadas ajustáveis por campo.
- Preenchimento de campos de formulários PDF editáveis quando os nomes correspondem; caso contrário, sobreposição de texto nas posições informadas.
- Modelo PDF demonstrativo incluído, com geração e download.

## Acessar o app

Abra [index.html](./index.html) em um navegador ou habilite **GitHub Pages** em **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**. Após a publicação do Pages, o endereço usual é:

https://silviohck.github.io/OrthckForm/

> A URL acima só funcionará após o GitHub Pages ter sido ativado e publicado com sucesso.

## Como usar

1. Escolha uma fotografia do manuscrito.
2. Clique em **Reconhecer localmente** ou, opcionalmente, use a IA com uma chave de API própria.
3. Revise e corrija a transcrição e todos os campos.
4. Use o PDF de demonstração ou carregue o seu PDF.
5. Para um modelo próprio, abra **Configurar as posições dos campos** e ajuste as coordenadas X/Y em porcentagens da página.
6. Clique em **Gerar e baixar PDF preenchido** e confira o documento resultante.

## Privacidade e segurança

- O app não possui banco de dados, contas nem backend e **não grava fotografias, PDFs ou campos**.
- O modo OCR local processa a imagem no navegador, embora bibliotecas e modelos sejam inicialmente baixados de CDNs.
- No modo IA, **a fotografia é enviada diretamente à API da OpenAI após confirmação**. A chave é inserida pelo usuário e apagada do campo ao terminar a requisição. **Não coloque uma chave de API fixa no código-fonte**, especialmente em um repositório público.
- **Não use dados identificáveis de pacientes reais em serviços externos sem avaliação de LGPD, consentimentos/bases legais, contrato de tratamento de dados, segurança e políticas de retenção apropriadas.**
- Este é um protótipo. Antes de uso clínico, implemente autenticação, trilha de auditoria, isolamento de dados, um backend seguro para IA e testes com documentos representativos.

## Limitações conhecidas

- OCR no navegador pode falhar com letra cursiva, fotos desfocadas ou manuscritos complexos.
- O preenchimento de PDFs não adivinha automaticamente a posição de campos não editáveis: configure as coordenadas no painel.
- Textos mais longos são limitados à área prevista para cada campo para evitar sobreposições.
- Fontes PDF padrão oferecem suporte restrito a caracteres e símbolos; caracteres não suportados podem ser substituídos por um ponto de interrogação.
- Arquivos PDF protegidos por senha não são aceitos.
- Integração direta da IA a partir do navegador pode ser afetada por restrições do navegador/CORS; para produção é recomendável um backend próprio.

## Tecnologias

HTML, CSS, JavaScript, [Tesseract.js 5](https://github.com/naptha/tesseract.js) e [pdf-lib](https://pdf-lib.js.org/). Sem build obrigatório.

## Próximos passos

Ajustar o mapeamento de campos com uma foto de exemplo e o **PDF modelo real**; testar com imagens de demonstração sem dados de pacientes e revisar segurança para eventual uso em consultório.
