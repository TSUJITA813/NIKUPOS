// この端末の設定（パスワードなしで、お店の人が誰でも変えられる設定）

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/app_state.dart';
import 'admin.dart' show SoundSettings;
import 'common.dart';

class DeviceSettingsPage extends StatefulWidget {
  const DeviceSettingsPage({super.key});
  @override
  State<DeviceSettingsPage> createState() => _DeviceSettingsPageState();
}

class _DeviceSettingsPageState extends State<DeviceSettingsPage> {
  late final TextEditingController dev, float;
  bool _inited = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_inited) return;
    _inited = true;
    final st = AppScope.read(context).settings;
    dev = TextEditingController(text: (st['deviceCode'] ?? '').toString());
    float = TextEditingController(text: st['floatDefault'] == null ? '' : '${st['floatDefault']}');
  }

  @override
  void dispose() {
    dev.dispose();
    float.dispose();
    super.dispose();
  }

  Future<void> save() async {
    final s = AppScope.read(context);
    s.settings['deviceCode'] = dev.text.trim();
    s.settings['floatDefault'] = int.tryParse(float.text.trim()) ?? 0;
    await s.saveSettings();
    s.log('settings', 'この端末の設定を保存');
    if (mounted) toast(context, '保存しました');
  }

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    Widget h2(String t) => Padding(padding: const EdgeInsets.only(top: 20, bottom: 4), child: Text(t, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)));
    return Scaffold(
      appBar: AppBar(backgroundColor: accent, foregroundColor: Colors.white, title: const Text('この端末の設定', style: TextStyle(fontWeight: FontWeight.w800))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 620),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: const Color(0xFFFFF8E6), borderRadius: BorderRadius.circular(10), border: Border.all(color: line)),
                child: const Text('ここは、お店の人なら誰でも変えられる設定です。\n売上の分析・原価・商品と値段・お店の情報は「管理」（パスワードが必要）で変えます。'),
              ),
              h2('操作音'),
              const SoundSettings(),
              h2('画面のレイアウト'),
              const Text('スマートフォン向けとタブレット向けの画面を切り替えられます。「自動」は画面の大きさで選びます。', style: TextStyle(color: muted)),
              RadioGroup<LayoutMode>(
                groupValue: s.layoutMode,
                onChanged: (v) => s.setLayoutMode(v!),
                child: Column(children: [
                  for (final m in LayoutMode.values)
                    RadioListTile<LayoutMode>(
                      key: ValueKey('layout-${m.name}'),
                      value: m,
                      title: Text(layoutModeLabel(m)),
                      subtitle: m == LayoutMode.auto ? Text('今の画面：${MediaQuery.sizeOf(context).shortestSide >= 600 ? 'タブレット向け' : 'スマートフォン向け'}') : null,
                    ),
                ]),
              ),
              h2('レジ'),
              TextField(
                key: const ValueKey('set-deviceCode'),
                controller: dev,
                decoration: const InputDecoration(labelText: 'この端末の記号（例：A）', helperMaxLines: 3, helperText: 'レジが2台以上のときに使います。取引番号の頭に付きます（例：A-12）。レジ締めも端末ごとに分かれます。'),
              ),
              const SizedBox(height: 8),
              TextField(
                key: const ValueKey('set-floatDefault'),
                controller: float,
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: const InputDecoration(labelText: '釣銭準備金のいつもの額（円）', prefixText: '¥ ', helperMaxLines: 3, helperText: '開店のときにレジに入れるおつり用のお金。前の日のレジ締めで「残す額」を入れていれば、そちらが使われます。'),
              ),
              const SizedBox(height: 12),
              FilledButton(key: const ValueKey('deviceSave'), onPressed: save, child: const Text('保存')),
            ]),
          ),
        ),
      ]),
    );
  }
}
