# SKR Designer

Ferramentas para game designers, num app de desktop com abas e workspaces.
O primeiro workspace é o **editor de Skill Tree**; outros (diálogos, itens,
quests) vão entrar como novos workspaces no mesmo app.

## Baixar

Na página de [Releases](https://github.com/ShinkiroG/SKR_Designer/releases)
há duas opções para Windows:

- **SKR-Designer-Setup-x.y.z.exe**: instalador. Cria atalho no menu Iniciar e
  na área de trabalho, e se atualiza sozinho pelo botão
  **Verificar atualizações**.
- **SKR-Designer-Portable-x.y.z.exe**: versão portátil, roda sem instalar
  (pendrive, pasta qualquer). O botão de atualizações avisa quando há versão
  nova e abre a página de download.

## Editor de Skill Tree

Funciona como os Blueprints da Unreal: cada habilidade é um nó com um pino de
entrada (esquerda) e um de saída (direita). Ligar a saída de A na entrada de B
faz de A um pré-requisito de B.

| Ação | Como |
| --- | --- |
| Nova habilidade | Duplo clique no fundo, tecla `N` ou menu do botão direito |
| Conectar | Arraste de um pino até outro nó |
| Criar já conectada | Arraste de um pino e solte no vazio |
| Desconectar | `Alt` + clique no pino, ou clique no fio e `Delete` |
| Selecionar vários | Arraste no fundo (caixa) ou `Ctrl`/`Shift` + clique |
| Mover | Arraste os nós selecionados (`Alt` desliga o encaixe na grade) ou setas |
| Mover a visão | Botão direito ou do meio arrastando, ou `Espaço` + arrastar |
| Zoom | Roda do mouse · `F` enquadra a seleção ou tudo |
| Copiar / colar / recortar / duplicar | `Ctrl+C` / `Ctrl+V` / `Ctrl+X` / `Ctrl+D` |
| Desfazer / refazer | `Ctrl+Z` / `Ctrl+Y` |
| Selecionar tudo | `Ctrl+A` |
| Modo Testar | `T` ou botão na barra: simula a distribuição de pontos |

Com vários nós selecionados, o painel lateral permite mudar cor, custo e
categoria de todos e alinhar ou distribuir.

Atalhos do app: `Ctrl+N` novo, `Ctrl+O` abrir, `Ctrl+S` salvar,
`Ctrl+Shift+S` salvar como, `Ctrl+W` fechar aba, `Ctrl+Tab` trocar de aba.
As abas abertas são restauradas quando o app abre de novo.

## Formato do arquivo

Documentos são JSON. Uma skill tree:

```json
{
  "type": "skill-tree",
  "version": 2,
  "name": "Guerreiro",
  "budget": 10,
  "nodes": [
    {
      "id": "n1",
      "name": "Golpe Forte",
      "description": "Ataque básico com +20% de dano.",
      "cost": 1,
      "maxRank": 3,
      "category": "Ataque",
      "color": "#ef6b6b",
      "x": 0,
      "y": 32,
      "prerequisites": []
    }
  ]
}
```

`prerequisites` lista os `id` exigidos. Arquivos da versão anterior (sem
`type`) também abrem. Exemplo completo em `exemplos/guerreiro.json`.

## Desenvolvimento

Requer Node.js 22.

```bash
npm install
npm start          # abre o app em modo desenvolvimento
npm run check      # verifica a sintaxe dos scripts
npm run dist       # gera instalador e portátil para Windows em dist/
```

A interface também abre direto no navegador (`src/index.html`), útil para
mexer só no visual; nesse caso salvar vira download.

### Estrutura

```
electron/            processo principal (janela, arquivos, atualizações)
src/shell.js         abas, tela inicial, salvar/abrir, sessão
src/platform.js      ponte com o sistema (Electron ou navegador)
src/workspaces/      um diretório por workspace
  skill-tree/
```

Um workspace novo é um script que chama `SKR.registerWorkspace({ id, name,
description, color, createDocument, matches, mount })`. `mount` recebe o
elemento onde desenhar, o documento e um contexto (`changed`, `toast`,
`clipboard`), e devolve um objeto com `getDocument()` e `getTitle()`.
Depois é só incluir o script em `src/index.html`.

### Publicar uma versão

1. Atualize `version` em `package.json` (ex.: `0.3.0`) e faça commit na `main`.
2. Crie e envie a tag: `git tag v0.3.0 && git push origin v0.3.0`.
3. O GitHub Actions gera o instalador e o portátil e publica a release.
   A partir daí, quem clicar em **Verificar atualizações** recebe a versão nova.

Cada pull request também gera os executáveis como artefato do workflow
**Build**, para testar antes de publicar.
