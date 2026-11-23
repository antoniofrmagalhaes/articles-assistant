# Assistente de publicação de artigos

Abra esta pasta no VS Code com Codex ou inicie `codex` em um terminal dentro dela. O agente seguirá `AGENTS.md` e trabalhará com os arquivos locais e dois MCPs próprios. Git e o repositório do site não são necessários.

## Dependências e requisitos

| Dependência                                   | Finalidade                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Node.js 22.12 ou superior e npm               | Instalação dos pacotes, scripts, validação e servidores MCP.                                        |
| Codex com acesso habilitado                   | Execução do agente pelo terminal ou pela extensão do VS Code.                                       |
| VS Code                                       | Ambiente de trabalho quando utilizada a extensão do Codex.                                          |
| Google Chrome                                 | Publicação pelo painel e conferência do texto renderizado no site.                                  |
| Conexão com a internet                        | Instalação de pacotes, uso do Codex e acesso aos serviços configurados.                             |
| Acesso ao projeto e dataset do Sanity         | Consulta e operações de conteúdo conforme as permissões da credencial.                              |
| Token do Sanity com as permissões necessárias | Consulta, publicação, atualização e exclusão pela API. Configurado localmente, sem envio pelo chat. |
| Conta autorizada no Studio                    | Necessária quando a publicação pelo painel estiver habilitada e for escolhida.                      |
| Documentos Word no formato DOCX               | Entrada de artigos novos. Arquivos DOC precisam de uma cópia convertida para DOCX.                  |

O app não requer Git, uma CLI global do Sanity nem os arquivos do repositório do site. O schema necessário à validação acompanha o aplicativo. Caso o endereço de conferência seja local, o site precisa estar disponível no computador que executará essa conferência.

As dependências de código são instaladas pelo npm:

| Pacote                      | Responsabilidade                                              |
| --------------------------- | ------------------------------------------------------------- |
| `@modelcontextprotocol/sdk` | Comunicação dos servidores e clientes MCP.                    |
| `@sanity/client`            | Consultas e operações de dados no Sanity.                     |
| `sanity` e `typescript`     | Carregamento do schema distribuído e execução das validações. |
| `chrome-devtools-mcp`       | Operação do Chrome pelo MCP local.                            |
| `mammoth`                   | Extração de texto e HTML dos documentos Word.                 |
| `cheerio`                   | Inspeção do HTML na conferência HTTP.                         |
| `groq-js`                   | Dependência de desenvolvimento para testes de consultas.      |

As versões estão declaradas em `package.json` e fixadas pelo `package-lock.json`. Use `npm ci` para reproduzir a instalação.

## Instalação

Execute os comandos dentro da pasta do aplicativo. Em PowerShell use `npm.cmd` para evitar bloqueio de `npm.ps1`; nos demais terminais, use `npm`.

```powershell
npm.cmd ci
npm.cmd run setup
```

O `setup` gera a configuração local dos MCPs e cria o `.env` a partir do modelo quando ele ainda não existe. Configure as credenciais e os destinos nesse arquivo e confira o perfil editorial antes de continuar. O modelo não representa necessariamente o destino desejado.

```powershell
npm.cmd run doctor
npm.cmd run doctor -- --remote
codex
```

O diagnóstico local verifica arquivos e configuração. A opção remota acrescenta consultas de leitura ao Sanity e verificações HTTP dos destinos. Ela não publica documentos e não substitui a conferência da conexão do Chrome ou um teste completo de publicação.

Depois de mover/copiar a pasta, execute `setup` novamente: ele configura os caminhos da cópia em `.codex/config.toml`, sem alterar configurações globais. Confie no workspace e reinicie o Codex se os MCPs ainda não aparecerem. A configuração local é compartilhada entre CLI e extensão, conforme a [documentação do Codex](https://developers.openai.com/codex/mcp/).

## Configuração e funcionamento

O `.env` desta cópia é a única fonte dos destinos. `SANITY_PROJECT_ID` e `SANITY_DATASET` definem o destino de dados; `SANITY_API_VERSION` seleciona a versão da API; `SANITY_API_TOKEN` fornece a credencial de acesso; `SITE_URL` define o endereço usado nos links e na conferência; `STUDIO_URL` e `STUDIO_ALIASES` definem o painel e seus aliases (separados por vírgulas). Esses valores são independentes: o nome do dataset não determina o domínio usado na conferência. O agente e as tools usam o que está configurado, sem sugerir substituição nem pedir confirmação para usar um endereço local. Exemplos e URLs antigas não sobrepõem o `.env`; destinos só são alterados por solicitação explícita.

As tools releem os destinos a cada chamada, e o navegador atualiza seu escopo conforme o `.env`. A mudança de `SITE_URL` não muda a identidade do documento no Sanity nem exige republicação. Falhas de conexão ou conteúdo são relatadas no endereço configurado, sem tentar outro host. Mudanças de conexão do Chrome (`CHROME_AUTO_CONNECT`) ainda exigem reiniciar o servidor do navegador. A cópia local pode conter credencial de uso local; não compartilhe `.env`. O pacote de transferência usa `.env.example` como modelo inicial, não como fonte de configuração vigente.

`ALLOW_UI_PUBLICATION=true` habilita cadastro pelo painel e a pergunta de como publicar. Com `false`, o agente publica diretamente após revisar e validar, **sem perguntar sobre UI/modo e sem outra confirmação de modo**. A tool direta seleciona o modo automaticamente; as tools do painel e a navegação para cadastrar no Studio ficam bloqueadas. O navegador continua disponível para conferir `SITE_URL`. A flag é relida a cada chamada; ausente, mantém `true` por compatibilidade. Ela não dispensa a validação nem resolve dados factuais ausentes.

Um draft anterior do mesmo artigo é descartado automaticamente ao iniciar/reiniciar a publicação, sem perguntar sobre sua exclusão. O agente recomeça do mesmo JSON e ID, preservando o documento publicado. No modo direto isso faz parte de `publish_article`; no painel a limpeza ocorre antes de preencher (`set_publication_mode` ou `reset_article_draft` numa retomada). O novo draft preenchido na tentativa atual é mantido até Publish. Rascunho de outro documento publicado não é tratado como se fosse o mesmo artigo.

Para o painel, abra Chrome com a sessão do Studio. Com `CHROME_AUTO_CONNECT=true`, habilite a conexão em `chrome://inspect/#remote-debugging` e autorize-a quando o Chrome solicitar. Alternativamente, configure `false` para o MCP usar seu próprio perfil e faça login nessa janela. Se estiver desconectado, o agente pedirá que você faça login e digite **“pronto”** no chat. Ele aguardará essa resposta, conferirá a sessão e continuará o mesmo artigo do ponto interrompido. Autenticação é feita pela pessoa; senhas, códigos e tokens não devem ser colados no chat.

## Fluxo editorial

Um pedido inicial pode ser: “Vamos testar estes três documentos. Use o fluxo daqui. Depois vamos corrigir um deles.” Forneça os arquivos ou suas localizações. O agente deve ler os arquivos, preparar o JSON, validar e seguir a flag. Para testar os dois modos, habilite `ALLOW_UI_PUBLICATION`; quando desabilitada, todos seguem diretamente sem pergunta.

Pesquisa e exclusão usam somente o MCP do Sanity, inclusive quando `Docs` está vazio. `search_articles` pesquisa título, slug, ID ou link; sem filtros lista o acervo, agrupando publicado e draft do mesmo ID em um artigo. Com pedido explícito e um resultado inequívoco, `delete_remote_article` exclui as duas versões e confirma sua ausência sem exigir Word/cadastro local nem abrir Chrome. Havendo vários artigos, o agente pergunta com base nos resultados reais. Recibos ficam em `operations/deletions/`; arquivos locais existentes são preservados.

Antes de excluir, `prepare_article_deletion` verifica arquivos correspondentes em `Docs/`. Se existirem, o agente pergunta **antes de qualquer exclusão** se deseja removê-los também e aguarda sim/não. Depois, a tool exclui primeiro publicado/draft no Sanity e confirma a ausência. Só então remove as pastas físicas aprovadas, se a resposta foi sim. Com não, os arquivos permanecem. Falha no Sanity preserva os arquivos; uma falha física é relatada separadamente. A associação usa o ID do artigo e o projeto/dataset, sem apagar pastas por simples semelhança de nome.

Words recebidos na raiz são organizados em `Docs/<slug>/` no registro. O importador confirma o SHA-256 da cópia e a extração antes de remover a entrada da raiz; em falha, mantém a origem. Uma nova chamada pode concluir a limpeza de uma duplicata idêntica já registrada. Não deixe Words `-publicado` na raiz. Arquivos recebidos de uma pasta externa são copiados, preservando a origem externa.

O agente localiza os arquivos com `list_word_files` antes de importar e utiliza o `sourcePath` retornado. O importador aceita caminhos absolutos ou relativos à raiz desta pasta, sem depender do diretório em que o processo MCP foi iniciado. Arquivos já registrados informam seu `articlePath` para retomada. Em erro de caminho, o agente deve corrigir o argumento a partir da listagem, sem repetir a mesma chamada inválida. Em PowerShell, a leitura dos documentos de instrução deve usar `-Encoding utf8` para exibir acentos corretamente.

Dados comuns ficam em `config/editorial-profile.json`: autora padrão, nome, biografia, nomes alternativos e política da nota de título. O agente consulta esse arquivo antes de perguntar autoria; `prepare_article` preenche apenas os campos ausentes. Cadastre outros autores em `authors` e selecione por `authorId` quando necessário. Atualizar o perfil não altera os artigos já preenchidos ou publicados.

Se o Word ou a cliente fornecer uma nota de título, ela é preservada. Quando faltar, o publicador redige uma frase neutra baseada no próprio artigo, sem inventar origem, evento ou publicação, e usa `apply_editorial_defaults`. O registro local `editorial-metadata.json` identifica o perfil utilizado e a origem da nota. Mudanças exigem nova revisão e validação antes de publicar.

## Comandos úteis

Execute dentro da pasta do aplicativo:

```powershell
npm.cmd run list:words
npm.cmd run doctor -- --remote
npm.cmd run search:articles
npm.cmd run search:articles -- "trecho do título ou link"
npm.cmd test
npm.cmd run package
```

Os comandos `import:word`, `validate:article` e `apply:editorial` recebem argumentos referentes ao documento escolhido. O agente também executa essas operações pelas tools, sem exigir que a pessoa monte os comandos manualmente.

O validador retorna **0** para objeto válido, **1** para erro de schema/estrutura e **2** para JSON ilegível ou falha de execução. Erros mostram o caminho do campo. Ele lê `schema/source`, com o snapshot identificado em `schema/version.json`; não consulta arquivos do site. Atualize o pacote deliberadamente se o schema do Studio mudar. Na publicação, `validate_article` acrescenta integridade do Word, revisão da conversão e identidade, e a tool de escrita valida novamente.

Não confunda gravação no Sanity com conferência pública: a resposta informa os dois resultados separadamente. Consulte `guides/fluxo.md`, `guides/estrutura-dos-artigos.md` e `guides/aceite.md`.

O verificador HTTP reconhece HTML em streaming do React/Next e retorna conferência pendente, sem inventar ausências. O agente conclui com `articles_devtools.check_public_page_rendered`: a tool lê o texto visível após a montagem do artigo, sempre no `SITE_URL` atual, e registra método, URL, horário e hash do JSON em `publication-state.json`. Divergências HTTP também devem ser confirmadas por essa tool antes de afirmar perda de conteúdo. Se o navegador não estiver disponível ou a página não terminar de renderizar, o site permanece pendente; isso não desfaz a publicação confirmada no Sanity. A comparação de texto é complementada pela inspeção visual da formatação.

## Migração para outro computador

O código resolve os arquivos a partir da própria pasta do aplicativo e não depende de caminhos do repositório pai. A configuração gerada dos MCPs contém caminhos absolutos da instalação atual: **execute o `setup` novamente após mover ou copiar a pasta**, para regenerá-los no destino. Não reutilize a configuração gerada em outro computador.

A pasta de desenvolvimento atual do aplicativo está ignorada pelo Git do repositório principal. **Clonar esse repositório, por si só, não transfere o aplicativo nem suas melhorias locais.** Use uma cópia da pasta ou gere o pacote portátil.

`npm run package` produz uma pasta de transferência com código, dependências declaradas, schema, instruções, guias, perfil editorial e modelo de ambiente. O pacote não inclui credenciais, dependências instaladas, documentos da cliente ou histórico operacional.

No computador de destino:

1. Instale os requisitos e copie a pasta portátil.
2. Execute `npm.cmd ci` dentro dessa pasta para instalar as dependências no destino.
3. Execute `npm.cmd run setup` para gerar os caminhos locais dos MCPs.
4. Configure o `.env` local e confira o perfil editorial. Não presuma que os valores do modelo representam a instalação desejada.
5. Transfira os documentos e seus registros de forma deliberada, caso queira continuar o histórico existente. Preserve os originais, JSONs e auxiliares de cada artigo.
6. Execute os diagnósticos local e remoto, configure a conexão do Chrome e faça login no Studio quando aplicável. Conexões e sessões do navegador precisam ser configuradas novamente no novo computador.
7. Abra o Codex na pasta do aplicativo, confie no workspace quando solicitado e reinicie a sessão para carregar os MCPs.
8. Valide o fluxo com um artigo antes do uso regular. O roteiro de aceite dos três artigos reais está em `guides/aceite.md`.

Se optar por copiar uma instalação existente inteira, repita a instalação das dependências e o `setup` no destino. Confira separadamente quais documentos e credenciais serão transferidos. Não dependa das dependências instaladas nem da configuração de MCPs trazidas do outro computador.

Este README registra os requisitos e procedimentos sem armazenar valores de configuração ou caminhos de uma máquina específica.
