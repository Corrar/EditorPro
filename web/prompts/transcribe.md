# Transcrição com tempos (legendas)

Transcreva **toda a fala** do arquivo anexado, no idioma indicado (padrão: português do Brasil),
para gerar legendas sincronizadas.

Regras:
- Tempos em **segundos desde o início do arquivo**, como números decimais (ex.: `12.48`), nunca
  em formato `MM:SS`.
- Divida em segmentos curtos de legenda (até ~8 palavras ou ~4 s), quebrando em pausas naturais
  e fim de frases.
- Para **cada palavra**, informe `start` e `end` o mais preciso possível (alinhado ao áudio).
- Escreva com ortografia e pontuação corretas, mas fiel ao que foi dito (sem resumir, sem
  traduzir, sem inventar). Mantenha gírias. Remova apenas hesitações puras ("éé", "hã").
- `emphasis`: até 2 palavras importantes do segmento (para destaque visual), quando houver.
- Não transcreva música, ruídos ou silêncio. Se não houver fala, devolva `segments: []`.

Responda **somente JSON**:
```json
{ "language": "pt-BR", "segments": [ { "start": 0.42, "end": 2.10, "text": "Olá, pessoal!", "words": [ {"start":0.42,"end":0.80,"text":"Olá,"}, {"start":0.85,"end":2.10,"text":"pessoal!"} ], "emphasis": ["pessoal"] } ] }
```
