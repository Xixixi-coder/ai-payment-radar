import datetime
d = datetime.date.today()
weekdays = ['周一','周二','周三','周四','周五','周六','周日']
week_num = d.isocalendar()[1]
print(f'{d.year}年{d.month}月{d.day}日 {weekdays[d.weekday()]}')
print(f'Week: {week_num}')
print(f'ISO: {d.isoformat()}')
