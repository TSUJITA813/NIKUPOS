# 操作音（WAV）を作る。外部の音源を使わず、その場で合成する。
#   python3 tool/gen_sounds.py
import math, struct, wave

RATE = 44100

def tone(freq, ms, vol=0.5, attack=3, decay=None, shape='sine'):
    n = int(RATE * ms / 1000)
    out = []
    for i in range(n):
        t = i / RATE
        if shape == 'square':
            v = 1.0 if math.sin(2 * math.pi * freq * t) >= 0 else -1.0
            v *= 0.35
        else:
            v = math.sin(2 * math.pi * freq * t) + 0.25 * math.sin(4 * math.pi * freq * t)
        a = min(1.0, i / (RATE * attack / 1000)) if attack else 1.0
        d = math.exp(-t / (decay / 1000)) if decay else 1.0
        tail = min(1.0, (n - i) / (RATE * 0.004))  # 最後をなめらかに（プチ音を防ぐ）
        out.append(v * vol * a * d * tail)
    return out

def silence(ms):
    return [0.0] * int(RATE * ms / 1000)

def save(name, samples):
    with wave.open(f'assets/sounds/{name}.wav', 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32000)) for s in samples))

save('key', tone(1700, 28, 0.45, attack=1, decay=10))                                   # テンキー
save('add', tone(1046, 45, 0.45, decay=60) + tone(1568, 70, 0.45, decay=60))            # 商品を追加
save('remove', tone(784, 55, 0.4, decay=60) + tone(523, 80, 0.4, decay=70))             # 削除
save('done', tone(1046, 110, 0.5, decay=180) + tone(1318, 110, 0.5, decay=180) + tone(1568, 320, 0.5, decay=260))  # 会計完了
save('error', tone(220, 120, 0.5, shape='square') + silence(50) + tone(220, 160, 0.5, shape='square'))  # エラー
save('hold', tone(880, 70, 0.4, decay=90) + tone(880, 70, 0.4, decay=90))               # 保留・呼び出し
print('ok')
