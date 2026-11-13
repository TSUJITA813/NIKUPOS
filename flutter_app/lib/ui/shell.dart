// 画面の枠（スマートフォン：下にタブ、タブレット：左にタブ）

import 'dart:async';

import 'package:flutter/material.dart';

import '../core/app_state.dart';
import 'admin.dart';
import 'common.dart';
import 'register.dart';
import 'sales.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int index = 0;
  Timer? timer;
  DateTime now = DateTime.now();

  @override
  void initState() {
    super.initState();
    timer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!mounted) return;
      final s = AppScope.read(context);
      final was = s.adminId != null;
      if (was && !s.isAdmin) toast(context, '一定時間操作がなかったため、管理画面からログアウトしました');
      setState(() => now = DateTime.now());
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  static const _dest = [
    (Icons.point_of_sale, 'レジ'),
    (Icons.receipt_long, '売上'),
    (Icons.lock_outline, '管理'),
  ];

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final tablet = useTabletLayout(context, s);
    final pages = const [RegisterPage(), SalesPage(), AdminPage()];
    final body = IndexedStack(index: index, children: pages);
    final appBar = AppBar(
      backgroundColor: accent,
      foregroundColor: Colors.white,
      toolbarHeight: tablet ? 52 : 48,
      title: Text('🐔 ${s.settings['storeName']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
      actions: [
        Padding(
          padding: const EdgeInsets.only(right: 12),
          child: Center(child: Text('${now.month}/${now.day} ${timeStr(now)}', style: const TextStyle(fontSize: 15))),
        ),
      ],
    );
    return Listener(
      onPointerDown: (_) => s.touch(),
      child: tablet
          ? Scaffold(
              appBar: appBar,
              body: Row(children: [
                NavigationRail(
                  selectedIndex: index,
                  labelType: NavigationRailLabelType.all,
                  onDestinationSelected: (i) => setState(() => index = i),
                  destinations: [for (final d in _dest) NavigationRailDestination(icon: Icon(d.$1), label: Text(d.$2))],
                ),
                const VerticalDivider(width: 1, color: line),
                Expanded(child: body),
              ]),
            )
          : Scaffold(
              appBar: appBar,
              body: body,
              bottomNavigationBar: NavigationBar(
                height: 62,
                selectedIndex: index,
                onDestinationSelected: (i) => setState(() => index = i),
                destinations: [for (final d in _dest) NavigationDestination(key: ValueKey('nav-${d.$2}'), icon: Icon(d.$1), label: d.$2)],
              ),
            ),
    );
  }
}
