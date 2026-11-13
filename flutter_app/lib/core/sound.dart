// 操作音（テンキー・商品の追加・削除・保留・会計完了・エラー）
// 音は assets/sounds/ の WAV（tool/gen_sounds.py で合成したもの）。
// 短い効果音に向いた鳴らし方（Android の SoundPool：PlayerMode.lowLatency）を使い、
// お店で流している音楽などを止めないよう、ほかの音と混ぜて鳴らす。端末ごとに ON/OFF と音量を選べる。
// 音の大きさは、端末の「メディアの音量」にも左右される。

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';

enum Sfx { key, add, remove, done, error, hold }

class Sound {
  static bool enabled = true;
  static double volume = 0.7;
  static bool _ready = false;
  static bool _initing = false;

  /// 準備できなかったときの理由（設定画面に出す）。準備できていれば空
  static String problem = '';

  /// 最後に鳴らそうとした音（テスト用）
  static Sfx? last;

  // 音ごとに数台の再生機を用意し、順番に使う（テンキーを速く押しても鳴るように）
  static final Map<Sfx, List<AudioPlayer>> _players = {};
  static final Map<Sfx, int> _next = {};

  static bool get ready => _ready;

  /// 音を読み込む。音が使えない環境（テストなど）では、理由を残して何もしない
  static Future<void> init() async {
    if (_initing) return;
    _initing = true;
    try {
      for (final list in _players.values) {
        for (final p in list) {
          await p.dispose();
        }
      }
      _players.clear();
      await AudioPlayer.global.setAudioContext(AudioContextConfig(focus: AudioContextConfigFocus.mixWithOthers).build());
      for (final s in Sfx.values) {
        final list = <AudioPlayer>[];
        for (var i = 0; i < (s == Sfx.key ? 3 : 2); i++) {
          final p = AudioPlayer();
          try {
            await p.setPlayerMode(PlayerMode.lowLatency); // 短い効果音向け
          } catch (_) {
            // この端末で使えなければ、ふつうの鳴らし方のまま
          }
          await p.setReleaseMode(ReleaseMode.stop);
          await p.setSource(AssetSource('sounds/${s.name}.wav'));
          list.add(p);
        }
        _players[s] = list;
        _next[s] = 0;
      }
      _ready = true;
      problem = '';
    } catch (e) {
      debugPrint('操作音を使えません: $e');
      _ready = false;
      problem = '$e';
    } finally {
      _initing = false;
    }
  }

  static void play(Sfx s) {
    last = s;
    if (!enabled || volume <= 0) return;
    if (!_ready) return;
    final list = _players[s];
    if (list == null || list.isEmpty) return;
    final i = _next[s]!;
    _next[s] = (i + 1) % list.length;
    final p = list[i];
    () async {
      try {
        await p.stop();
        await p.setVolume(volume);
        await p.resume();
      } catch (e) {
        debugPrint('操作音を鳴らせません: $e');
        problem = '$e';
      }
    }();
  }
}
