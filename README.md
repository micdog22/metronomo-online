# Metrônomo Online: metrônomo preciso com acentos e subdivisões (HTML + JS)

Um metrônomo de verdade no navegador para estudar música: andamento de 30 a 300 BPM, compassos simples e compostos, acento no primeiro tempo, subdivisões, três sons sintetizados e um treino progressivo que acelera sozinho. Sem instalar nada, sem cadastro e sem arquivos de áudio.

**Acesse online:** https://micdog22.github.io/metronomo-online/

## Recursos

- BPM de 30 a 300: controle deslizante, campo numérico e botões - e +.
- Tap tempo: toque no ritmo da música (botão ou tecla T). O andamento é a média dos toques recentes, e a contagem recomeça depois de 2 segundos parado.
- Compassos 2/4, 3/4, 4/4, 5/4, 6/8, 7/8 e 12/8, com acento opcional no 1º tempo.
- Subdivisões em colcheias, tercinas e semicolcheias (as opções se ajustam ao compasso).
- Três sons sintetizados na hora com Web Audio: clique, bip e madeira.
- Volume, indicadores visuais de cada pulso e o nome do andamento (Largo, Adagio, Andante, Allegro…).
- Treino progressivo: sobe X BPM a cada N compassos até um limite.
- Atalhos de teclado e preferências salvas no navegador.
- Mantém a tela acesa enquanto toca, nos navegadores que permitem.

## Como usar

1. Escolha o andamento (arraste, digite ou use - e +) ou toque no **Tap tempo** no ritmo da música.
2. Escolha o compasso, a subdivisão e o som.
3. Clique em **Iniciar** (ou aperte Espaço).

Para o treino progressivo, ative a opção, defina quanto aumentar, a cada quantos compassos e até onde. Por exemplo: começando em 80 BPM, subir 5 BPM a cada 4 compassos até 120 BPM. Se você mudar o BPM durante o treino, a progressão continua a partir do novo valor.

## Compassos e subdivisões

| Compasso | O BPM conta | Subdivisões |
| --- | --- | --- |
| 2/4, 3/4, 4/4, 5/4 | semínima (♩) | colcheias (2 por tempo), tercinas (3), semicolcheias (4) |
| 6/8 e 12/8 (compostos) | semínima pontuada (♩.): cada tempo tem 3 colcheias | colcheias (3 por tempo), semicolcheias (6) |
| 7/8 | colcheia (♪), agrupada em 2+2+3 | semicolcheias (2 por colcheia) |

No 7/8, o início de cada grupo é destacado; com o acento ligado, o 1º tempo soa mais forte que os outros.

## Andamentos

| Andamento | BPM |
| --- | --- |
| Largo | até 59 |
| Larghetto | 60 a 65 |
| Adagio | 66 a 75 |
| Andante | 76 a 107 |
| Moderato | 108 a 119 |
| Allegro | 120 a 155 |
| Vivace | 156 a 175 |
| Presto | 176 a 199 |
| Prestissimo | 200 ou mais |

As faixas são aproximadas e variam de uma fonte para outra; servem de referência.

## Atalhos de teclado

| Tecla | Ação |
| --- | --- |
| Espaço | iniciar ou parar |
| ↑ ou → | mais 1 BPM |
| ↓ ou ← | menos 1 BPM |
| Shift + setas | 5 BPM por vez |
| T | tap tempo |

## Como funciona

Um `setTimeout` por batida atrasa sempre que o navegador está ocupado, e o atraso se ouve. Aqui o tempo vem do relógio de áudio: a cada 25 ms um agendador verifica quais pulsos caem nos próximos 100 ms e agenda cada um em `AudioContext.currentTime`, que é preciso. O desenho na tela só acompanha o que já foi agendado. O treino progressivo muda o andamento sempre na virada do compasso.

O áudio só é criado depois que você clica em Iniciar (ou aperta Espaço), como os navegadores exigem. Se não ouvir nada no celular, confira o volume do aparelho.

## Como rodar localmente

Módulos ES não carregam via `file://`, então sirva a pasta com qualquer servidor estático:

```bash
python3 -m http.server 8000
```

E abra http://localhost:8000.

## Testes

```bash
npm test
```

(ou `node --test`, com Node 18 ou mais recente). Os testes cobrem tap tempo, padrões de cada compasso e subdivisão, níveis de acento, faixas de andamento, treino progressivo, a matemática do agendador, atalhos e a validação das preferências salvas.

## Contribuindo

Issues e pull requests são bem-vindos.

## Licença

MIT. Veja [LICENSE](LICENSE).
