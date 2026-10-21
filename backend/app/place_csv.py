"""CSV parsing only. Coordinates are resolved by the existing geocoding service."""
import csv
import io
import re

COLUMNS = ['지점명','분류','도로명주소','우편번호','상세주소','아이콘이름','강화구역','반지름(m)','완충배수','알림타입','음성안내']
REQUIRED = {'지점명','분류','도로명주소'}

def parse_csv(raw):
    if len(raw)>1024*1024: raise ValueError('CSV는 최대 1MB까지 업로드할 수 있습니다.')
    try: text = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        try: text = raw.decode('cp949')
        except UnicodeDecodeError: raise ValueError('UTF-8 또는 CP949로 저장한 CSV 파일을 사용해 주세요.')
    if '\x00' in text: raise ValueError('올바른 CSV 파일이 아닙니다.')
    reader=csv.DictReader(io.StringIO(text,newline=''),strict=True)
    fields=[(name or '').strip() for name in reader.fieldnames or []]
    if len(fields)!=len(set(fields)): raise ValueError('중복된 열 이름이 있습니다.')
    if not REQUIRED.issubset(fields): raise ValueError('필수 열: 지점명, 분류, 도로명주소')
    if set(fields)-set(COLUMNS): raise ValueError('알 수 없는 열: '+', '.join(set(fields)-set(COLUMNS)))
    reader.fieldnames=fields
    rows=[]
    for record in reader:
        if None in record: raise ValueError(f'{reader.line_num}행의 열 개수가 맞지 않습니다. 쉼표가 포함된 값은 큰따옴표로 감싸 주세요.')
        if not any((v or '').strip() for v in record.values()): continue
        rows.append((reader.line_num,{k:(v or '').strip() for k,v in record.items()}))
        if len(rows)>50: raise ValueError('한 번에 최대 50개 지점을 등록할 수 있습니다.')
    if not rows: raise ValueError('등록할 데이터가 없습니다.')
    return rows

def row_payload(record, icons):
    enhanced=record.get('강화구역','').lower() or 'n'
    if enhanced not in ('y','n'): raise ValueError('강화구역은 Y 또는 N을 입력해 주세요.')
    if record.get('우편번호') and not re.fullmatch(r'\d{5}',record['우편번호']): raise ValueError('우편번호는 비우거나 5자리 숫자로 입력해 주세요.')
    icon_name=record.get('아이콘이름','')
    matches=[icon for icon in icons if icon.name==icon_name]
    if icon_name and len(matches)!=1: raise ValueError('아이콘이름이 없거나 중복됩니다. 목록의 정확한 이름을 입력하거나 비워 주세요.')
    return {'name':record.get('지점명',''),'category':record.get('분류',''),'address':record.get('도로명주소',''),
            'postal_code':record.get('우편번호',''),'detail':record.get('상세주소',''),
            'icon_id':matches[0].id if matches else None,'enhanced':enhanced=='y',
            'radius':float(record.get('반지름(m)') or 50),'multiplier':float(record.get('완충배수') or 1.5),
            'alert_type':record.get('알림타입') or 'warning','message':record.get('음성안내','')}
