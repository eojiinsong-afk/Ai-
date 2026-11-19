"""index.html(아티팩트용, 문서 골격 없음) → app.html(GitHub Pages 등 일반 웹페이지용, 완전한 HTML 문서).

사용:  python3 photo-sorting/tools/build_web.py
같은 코드가 아티팩트에서는 올려 둔 건물 데이터와 Claude 분류를, 일반 웹페이지에서는 브이월드 API를 쓴다.
"""
import os

here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, '..', 'index.html')
dst = os.path.join(here, '..', 'app.html')
body = open(src, encoding='utf-8').read()
head = ('<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<!-- 자동 생성: tools/build_web.py 로 index.html 에서 만든다. 직접 고치지 말 것 -->\n'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
        '</head>\n<body>\n')
open(dst, 'w', encoding='utf-8').write(head + body + '\n</body>\n</html>\n')
print('wrote', os.path.relpath(dst))
