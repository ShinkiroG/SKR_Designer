# SKR Designer · Skill Tree

Editor primitivo de árvores de habilidades (skill trees) para game designers.
Não precisa instalar nada: é HTML, CSS e JavaScript puro.

## Como abrir

Abra `index.html` no navegador (duplo clique no arquivo já funciona).

## O que dá para fazer

- Criar habilidades com nome, descrição, custo, nível máximo, categoria e cor.
- Ligar habilidades por pré-requisitos (o editor impede ciclos).
- Ver a árvore num canvas com zoom, arrastar nós e mover a visão.
- **Modo Testar**: definir um orçamento de pontos e simular a distribuição,
  respeitando pré-requisitos e custos.
- Salvar e abrir a árvore em JSON. O trabalho também fica salvo
  automaticamente no navegador.

## Atalhos

| Ação | Como |
| --- | --- |
| Novo nó | Duplo clique no fundo, botão **+ Nó** ou tecla `N` |
| Mover nó | Arrastar |
| Mover visão / zoom | Arrastar o fundo / roda do mouse |
| Pré-requisito | Selecione um nó e **Shift + clique** em outro (o selecionado vira pré-requisito do clicado) |
| Excluir | `Delete` |
| Salvar JSON | `Ctrl + S` |
| Teste: desbloquear / devolver | Clique / clique direito |

## Formato do JSON

```json
{
  "version": 1,
  "name": "Guerreiro",
  "nodes": [
    {
      "id": "n1",
      "name": "Golpe Forte",
      "description": "Ataque básico com +20% de dano.",
      "cost": 1,
      "maxRank": 3,
      "category": "Ataque",
      "color": "#ef6b6b",
      "x": 100,
      "y": 60,
      "prerequisites": []
    }
  ]
}
```

`prerequisites` lista os `id` das habilidades que precisam estar
desbloqueadas antes. Há um exemplo completo em `exemplos/guerreiro.json`.
