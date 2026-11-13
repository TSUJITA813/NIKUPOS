// クラウド同期の設定（接続・状態・今すぐ同期・切断）

import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/sync.dart';
import 'common.dart';

String syncStateLabel(CloudSync? s) {
  if (s == null || !s.enabled) return '使っていません';
  return switch (s.state) {
    SyncState.off => '使っていません',
    SyncState.idle => s.pending > 0 ? '送信待ち ${s.pending}件' : '同期済み',
    SyncState.syncing => '同期中…',
    SyncState.offline => 'オフライン（つながったら送ります${s.pending > 0 ? '・送信待ち ${s.pending}件' : ''}）',
    SyncState.error => 'エラー：${s.error}',
  };
}

Color syncStateColor(CloudSync? s) {
  if (s == null || !s.enabled) return muted;
  return switch (s.state) {
    SyncState.idle => s.pending > 0 ? const Color(0xFFD9A441) : okColor,
    SyncState.syncing => costColor,
    SyncState.offline => const Color(0xFFD9A441),
    SyncState.error => danger,
    SyncState.off => muted,
  };
}

/// 上の帯に出す同期の状態
class SyncIndicator extends StatelessWidget {
  const SyncIndicator({super.key});
  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final sync = s.sync;
    if (sync == null || !sync.enabled) return const SizedBox.shrink();
    final icon = switch (sync.state) {
      SyncState.error => Icons.cloud_off,
      SyncState.offline => Icons.cloud_off,
      SyncState.syncing => Icons.cloud_sync,
      _ => sync.pending > 0 ? Icons.cloud_upload : Icons.cloud_done,
    };
    return IconButton(
      key: const ValueKey('syncDot'),
      tooltip: 'クラウド同期：${syncStateLabel(sync)}',
      icon: Icon(icon, color: sync.state == SyncState.error ? const Color(0xFFFFD27A) : Colors.white),
      onPressed: () {
        toast(context, 'クラウド同期：${syncStateLabel(sync)}');
        sync.syncNow();
      },
    );
  }
}

class SyncSettings extends StatefulWidget {
  /// Web版の管理画面の最初（つなぐまで先に進めない）
  final bool firstRun;
  const SyncSettings({super.key, this.firstRun = false});
  @override
  State<SyncSettings> createState() => _SyncSettingsState();
}

class _SyncSettingsState extends State<SyncSettings> {
  final apiKey = TextEditingController(), projectId = TextEditingController(), email = TextEditingController(), password = TextEditingController();
  late final TextEditingController dev;
  String msg = '';
  bool busy = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final s = AppScope.read(context);
    dev = TextEditingController(text: (s.settings['deviceCode'] ?? '') as String);
    final c = s.sync?.cfg ?? const {};
    apiKey.text = (c['apiKey'] ?? '') as String;
    projectId.text = (c['projectId'] ?? '') as String;
    email.text = (c['email'] ?? '') as String;
  }

  @override
  void dispose() {
    for (final c in [apiKey, projectId, email, password, dev]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _hasLocalData {
    final s = AppScope.read(context);
    return s.store.sales.isNotEmpty || s.reservations.isNotEmpty;
  }

  Future<void> connect() async {
    final s = AppScope.read(context);
    final sync = s.sync!;
    if ([apiKey, projectId, email, password].any((c) => c.text.trim().isEmpty)) return setState(() => msg = 'すべての欄を入れてください');
    if (!widget.firstRun && dev.text.trim().isEmpty) return setState(() => msg = '端末の記号を入れてください（例：店頭は A、卸は B）');
    setState(() { busy = true; msg = '確認しています…'; });
    try {
      await sync.checkLogin(apiKey.text.trim(), email.text.trim(), password.text);
    } on SyncError catch (e) {
      return setState(() { busy = false; msg = 'ログインできませんでした：${e.message}'; });
    } catch (e) {
      return setState(() { busy = false; msg = 'つながりませんでした。インターネットの接続を確認してください。'; });
    }
    var cloudOnly = false;
    if (_hasLocalData && mounted) {
      final ans = await showDialog<String>(
        context: context,
        barrierDismissible: false,
        builder: (c) => AlertDialog(
          title: const Text('この端末のデータ'),
          content: const Text('この端末にも売上や予約があります。どうしますか？'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c, 'cloud'), child: const Text('この端末のデータは使わない（クラウドに合わせる）')),
            FilledButton(key: const ValueKey('syncMerge'), onPressed: () => Navigator.pop(c, 'merge'), child: const Text('この端末のデータもクラウドに送る')),
          ],
        ),
      );
      cloudOnly = ans == 'cloud';
    }
    if (dev.text.trim().isNotEmpty) {
      s.settings['deviceCode'] = dev.text.trim();
      await s.saveSettings();
    }
    setState(() => msg = 'クラウドのデータを受け取っています…');
    try {
      await sync.connect(apiKey: apiKey.text.trim(), projectId: projectId.text.trim(), email: email.text.trim(), password: password.text, cloudOnly: cloudOnly);
      password.clear();
      s.log('sync', 'クラウド同期に接続（${email.text.trim()}）');
      if (mounted) {
        setState(() { busy = false; msg = ''; });
        toast(context, 'クラウド同期に接続しました');
      }
    } catch (e) {
      if (mounted) setState(() { busy = false; msg = '接続できませんでした：$e'; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final sync = s.sync;
    if (sync == null) return const Text('この画面ではクラウド同期を使えません。', style: TextStyle(color: muted));
    if (sync.enabled) {
      return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(Icons.circle, size: 12, color: syncStateColor(sync)),
          const SizedBox(width: 6),
          Expanded(child: Text(syncStateLabel(sync), key: const ValueKey('syncState'))),
        ]),
        Text('お店のアカウント：${sync.cfg['email']}　この端末の記号：${(s.settings['deviceCode'] ?? '') == '' ? '（なし）' : s.settings['deviceCode']}', style: const TextStyle(color: muted)),
        if (sync.lastSync.isNotEmpty) Text('最後に同期：${timeStr(DateTime.parse(sync.lastSync).toLocal())}', style: const TextStyle(color: muted)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          FilledButton(key: const ValueKey('syncNow'), onPressed: () => sync.syncNow(), child: const Text('今すぐ同期')),
          OutlinedButton(onPressed: () => sync.resendAll(), child: const Text('この端末のデータを全部送り直す')),
          TextButton(
            style: TextButton.styleFrom(foregroundColor: danger),
            onPressed: () async {
              if (!await confirmDialog(context, 'クラウド同期をやめますか？（この端末のデータは消えません。ほかの端末とは共有されなくなります）', ok: '同期をやめる', dangerous: true)) return;
              await sync.disconnect();
              s.log('sync', 'クラウド同期を切断');
            },
            child: const Text('同期をやめる'),
          ),
        ]),
      ]);
    }
    return AutofillGroup(
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Firebase（Google）のプロジェクトに、お店のアカウントでつなぎます。全部の端末と管理画面で同じアカウントを使うと、売上・予約・商品・設定が共有されます。準備のしかたは README の「複数の端末で使う」を見てください。',
            style: TextStyle(color: muted)),
        if (!widget.firstRun) TextField(key: const ValueKey('syncDev'), controller: dev, decoration: const InputDecoration(labelText: 'この端末の記号（例：店頭は A、卸は B。端末ごとに別の記号）')),
        TextField(key: const ValueKey('syncApiKey'), controller: apiKey, autocorrect: false, decoration: const InputDecoration(labelText: 'APIキー（Web API Key）')),
        TextField(key: const ValueKey('syncProject'), controller: projectId, autocorrect: false, decoration: const InputDecoration(labelText: 'プロジェクトID')),
        TextField(key: const ValueKey('syncEmail'), controller: email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.email], autocorrect: false, decoration: const InputDecoration(labelText: 'お店用のメールアドレス')),
        TextField(key: const ValueKey('syncPassword'), controller: password, obscureText: true, autofillHints: const [AutofillHints.password], decoration: const InputDecoration(labelText: 'お店用のパスワード')),
        const SizedBox(height: 8),
        if (msg.isNotEmpty) Text(msg, key: const ValueKey('syncMsg'), style: TextStyle(color: msg.endsWith('…') ? muted : danger)),
        const SizedBox(height: 8),
        FilledButton(key: const ValueKey('syncConnect'), onPressed: busy ? null : connect, child: const Text('接続する')),
      ]),
    );
  }
}
