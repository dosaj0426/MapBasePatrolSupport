"""작은 지도용 픽토그램을 SVG 원본과 투명 PNG로 함께 생성한다."""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'backend/assets/default-icons'
DEST.mkdir(parents=True, exist_ok=True)

class Icon:
    def __init__(self, color):
        self.color=color; self.image=Image.new('RGBA',(384,384)); self.draw=ImageDraw.Draw(self.image); self.svg=[]
    def coords(self, box): return tuple(round(x*8) for x in box)
    def ellipse(self, box, color=None):
        c=color or self.color; self.draw.ellipse(self.coords(box),fill=c)
        x,y,x2,y2=box; self.svg.append(f'<ellipse cx="{(x+x2)/2}" cy="{(y+y2)/2}" rx="{(x2-x)/2}" ry="{(y2-y)/2}" fill="{c}"/>')
    def polygon(self, points, color=None):
        c=color or self.color; self.draw.polygon([self.coords(p) for p in points],fill=c)
        self.svg.append(f'<polygon points="{" ".join(f"{x},{y}" for x,y in points)}" fill="{c}"/>')
    def line(self, points, width=3, color=None):
        c=color or self.color; self.draw.line([self.coords(p) for p in points],fill=c,width=round(width*8),joint='curve')
        r=width/2
        for x,y in points: self.draw.ellipse(self.coords((x-r,y-r,x+r,y+r)),fill=c)
        self.svg.append(f'<polyline points="{" ".join(f"{x},{y}" for x,y in points)}" stroke="{c}" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>')
    def save(self,name):
        self.image=self.image.resize((128,128),Image.Resampling.LANCZOS)
        self.image.save(DEST/(name+'.png'))
        (DEST/(name+'.svg')).write_text('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 48 48">'+''.join(self.svg)+'</svg>',encoding='utf8')

items=[]
def finish(icon,name,key):
    icon.save(name); items.append({'name':name,'key':key,'source':name+'.png','filename':'default-'+key+'.png'})

icon=Icon('#f00098')
icon.ellipse((10,5,38,36))
icon.ellipse((17,14,31,33),'#ffffff')
icon.polygon([(15,15),(28,11),(33,21),(27,16),(20,21)])
icon.polygon([(12,27),(18,31),(18,36),(13,41),(8,37)])
icon.polygon([(36,27),(30,31),(30,36),(35,41),(40,37)])
finish(icon,'여성안심귀갓길','safe-walk')

icon=Icon('#8983b3')
shield=[(24,5),(41,12),(39,27),(32,38),(24,44),(16,38),(9,27),(7,12)]
icon.polygon(shield)
icon.polygon([(14,23),(24,14),(34,23),(34,33),(14,33)],'#ffffff')
icon.polygon([(22,26),(27,26),(27,34),(22,34)])
finish(icon,'우범자 거주지역','residence')

icon=Icon('#168d92')
icon.line([(10,21),(10,40),(38,40),(38,21)],3)
icon.polygon([(11,9),(37,9),(42,21),(6,21)])
icon.line([(17,12),(15,19)],2,'#ffffff')
icon.line([(30,12),(32,19)],2,'#ffffff')
icon.ellipse((21,25,27,31))
icon.polygon([(20,32),(28,32),(31,38),(17,38)])
finish(icon,'여성 1인 사업장','woman-business')

icon=Icon('#e69a20')
icon.polygon(shield)
icon.line([(16,24),(22,30),(33,18)],4,'#ffffff')
finish(icon,'범죄예방 강화구역','prevention-zone')

icon=Icon('#437bd1')
icon.polygon([(7,14),(29,8),(36,21),(14,27)])
icon.polygon([(32,11),(41,12),(43,17),(37,20)])
icon.line([(24,27),(24,35),(38,35)],3.5)
icon.line([(39,29),(39,41)],4)
icon.line([(12,17),(27,13)],2,'#ffffff')
finish(icon,'CCTV','cctv')

(DEST/'manifest.json').write_text(json.dumps(items,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
# 원본 참조 이미지를 편집하지 않고 새 자산의 확인용 시트를 렌더링한다.
preview=Image.new('RGB',(1000,220),'#f6f8fa'); draw=ImageDraw.Draw(preview)
font=ImageFont.truetype('C:/Windows/Fonts/malgun.ttf',17)
for index,item in enumerate(items):
    x=index*200
    draw.rounded_rectangle((x+12,14,x+188,204),radius=14,fill='white',outline='#e0e6eb')
    image=Image.open(DEST/item['source']); preview.paste(image,(x+36,30),image)
    draw.text((x+100,174),item['name'],font=font,fill='#384552',anchor='mm')
preview.save(ROOT/'default-icons-preview.png')
print('생성 완료:', ', '.join(x['name'] for x in items))
