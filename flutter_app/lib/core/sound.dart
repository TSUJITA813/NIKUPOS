// 操作音（テンキー・商品の追加・削除・保留・会計完了・エラー）
// 音は assets/sounds/ の WAV（tool/gen_sounds.py で合成したもの）。
// お店で流している音楽などを止めないよう、ほかの音と混ぜて鳴らす。端末ごとに ON/OFF と音量を選べる。

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';

enum Sfx { key, add, remove, done, error, hold }

class Sound {
  static bool enabled = true;
  static double volume = 0.7;
  static bool _ready = false;
  static final Map<Sfx, AudioPool> _pools = {};

  /// 最後に鳴らした音（テスト用）
  static Sfx? last;

  /// 音を読み込む。音が使えない環境（テストなど）では何もしない
  static Future<void> init() async {
    try {
      await AudioPlayer.global.setAudioContext(AudioContextConfig(focus: AudioContextConfigFocus.mixWithOthers).build());
      for (final s in Sfx.values) {
        _pools[s] = await AudioPool.createFromAsset(path: 'sounds/${s.name}.wav', maxPlayers: s == Sfx.key ? 4 : 2);
      }
      _ready = true;
    } catch (e) {
      debugPrint('操作音を使えません: $e');
      _ready = false;
    }
  }

  static void play(Sfx s) {
    last = s;
    if (!enabled || !_ready || volume <= 0) return;
    final pool = _pools[s];
    if (pool == null) return;
    pool.start(volume: volume).catchError((Object e) async {
      debugPrint('操作音を鳴らせません: $e');
      return () async {};
    });
  }
}
