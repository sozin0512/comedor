#!/usr/bin/env python3
"""
Unifica cómo se muestran los lempiras en js/app.js: «L. ${x.toFixed(2)}», «L. ${x}»,
«L. ${Math.round(x)}» y «L. ${x.toFixed(0)}» → «${formatLempiras(x)}» (L. 1,234.00).
Idempotente: se puede volver a correr después de un merge.
"""
import re, sys, pathlib
p = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'js/app.js')
s = p.read_text(encoding='utf-8')
before = s
inner = r'([^{}`]+?)'
# 1) x.toFixed(2|0|1)
s = re.sub(r'L\. \$\{' + inner + r'\.toFixed\([012]\)\}', lambda m: '${formatLempiras(' + m.group(1) + ')}', s)
# 2) Math.round(x)
s = re.sub(r'L\. \$\{Math\.round\(' + inner + r'\)\}', lambda m: '${formatLempiras(Math.round(' + m.group(1) + '))}', s)
# 3) valor directo (identificador o propiedad)
s = re.sub(r'L\. \$\{([A-Za-z_$][\w$.?]*)\}', lambda m: '${formatLempiras(' + m.group(1) + ')}', s)
n = sum(1 for _ in re.finditer(r'formatLempiras\(', s)) - sum(1 for _ in re.finditer(r'formatLempiras\(', before))
p.write_text(s, encoding='utf-8')
print(f'{p}: {n} cambios')
