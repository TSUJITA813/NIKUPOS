// 画面の枠（スマートフォン：下にタブ、タブレット：左にタブ）

import 'dart:async';

import 'package:flutter/material.dart';

import '../core/app_state.dart';
import 'admin.dart';
import 'common.dart';
import 'register.dart';
import 'reservations.dart';
import '../core/profit.dart' show ymd;
import '../core/reservation.dart';
import 'sales.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  Timer? timer;
  DateTime now = DateTime.now();

  void _onTab() => setState(() {});

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final s = AppScope.read(context);
    s.tab.removeListener(_onTab);
    s.tab.addListener(_onTab);
  }

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
    (Icons.event_note, '予約'),
    (Icons.receipt_long, '売上'),
    (Icons.lock_outline, '管理'),
  ];

  @override
  Widget build(BuildContext context) {
    final s = AppScope.of(context);
    final tablet = useTabletLayout(context, s);
    final index = s.tab.value;
    final pages = const [RegisterPage(), ReservationsPage(), SalesPage(), AdminPage()];
    final body = IndexedStack(index: index, children: pages);
    final today = ymd(DateTime.now());
    final todayResv = s.reservations.where((r) => r['date'] == today && isActiveReservation(r)).length;
    Widget icon(int i) {
      final ic = Icon(_dest[i].$1);
      return i == 1 && todayResv > 0 ? Badge(key: const ValueKey('resvBadge'), label: Text('$todayResv'), child: ic) : ic;
    }
    void go(int i) => s.tab.value = i;
    final appBar = AppBar(
      backgroundColor: accent,
      foregroundColor: Colors.white,
      toolbarHeight: tablet ? 52 : 48,
      title: Text('🐔 ${s.settings['storeName']}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
      actions: [
        IconButton(
          key: const ValueKey('soundToggle'),
          tooltip: s.soundOn ? '操作音：オン（タップで消す）' : '操作音：オフ（タップで鳴らす）',
          icon: Icon(s.soundOn ? Icons.volume_up : Icons.volume_off),
          onPressed: () {
            s.setSound(on: !s.soundOn);
            toast(context, s.soundOn ? '操作音をオンにしました' : '操作音をオフにしました');
          },
        ),
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
                  onDestinationSelected: go,
                  destinations: [for (var i = 0; i < _dest.length; i++) NavigationRailDestination(icon: icon(i), label: Text(_dest[i].$2))],
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
                onDestinationSelected: go,
                destinations: [for (var i = 0; i < _dest.length; i++) NavigationDestination(key: ValueKey('nav-${_dest[i].$2}'), icon: icon(i), label: _dest[i].$2)],
              ),
            ),
    );
  }
}
