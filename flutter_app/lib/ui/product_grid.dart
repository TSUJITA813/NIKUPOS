// レジの商品ボタンの並び（長押しして動かすと並べ替え。Android のホーム画面のアプリの並べ替えと同じ操作）

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/calc.dart';
import '../core/sound.dart';
import 'common.dart';
import 'register.dart' show ProductTile;

class ProductGrid extends StatefulWidget {
  final List<Json> products;
  final Map<Object?, num> counts;
  final bool tablet;

  /// 並べ替えができるか（検索中はできない）
  final bool canReorder;
  final void Function(Json p) onTap;
  const ProductGrid({super.key, required this.products, required this.counts, required this.tablet, required this.canReorder, required this.onTap});

  @override
  State<ProductGrid> createState() => _ProductGridState();
}

class _ProductGridState extends State<ProductGrid> with SingleTickerProviderStateMixin {
  bool editing = false;

  /// 動かしている途中の並び
  List<Json>? work;
  String? dragId;
  Offset? lastPos;
  Timer? autoScroll;
  final sc = ScrollController();
  final gridKey = GlobalKey();
  late final AnimationController wiggle = AnimationController(vsync: this, duration: const Duration(milliseconds: 240));

  @override
  void didUpdateWidget(ProductGrid old) {
    super.didUpdateWidget(old);
    if (!widget.canReorder && editing) _stopEditing();
  }

  @override
  void dispose() {
    autoScroll?.cancel();
    wiggle.dispose();
    sc.dispose();
    super.dispose();
  }

  void _startEditing() {
    if (!editing) {
      HapticFeedback.mediumImpact();
      wiggle.repeat(reverse: true);
    }
    setState(() => editing = true);
  }

  void _stopEditing() {
    wiggle.stop();
    wiggle.value = 0;
    setState(() {
      editing = false;
      work = null;
      dragId = null;
    });
  }

  void _dragStart(Json p) {
    _startEditing();
    setState(() {
      work = widget.products.toList();
      dragId = p['id'] as String;
    });
    autoScroll?.cancel();
    autoScroll = Timer.periodic(const Duration(milliseconds: 16), (_) => _autoScroll());
  }

  /// 指が上下の端の近くにあれば、少しずつスクロールする
  void _autoScroll() {
    final pos = lastPos;
    final box = gridKey.currentContext?.findRenderObject() as RenderBox?;
    if (pos == null || box == null || !sc.hasClients) return;
    final y = box.globalToLocal(pos).dy;
    const edge = 70.0;
    double d = 0;
    if (y < edge) d = -(edge - y) / 5;
    if (y > box.size.height - edge) d = (y - (box.size.height - edge)) / 5;
    if (d == 0) return;
    final to = (sc.offset + d).clamp(0.0, sc.position.maxScrollExtent);
    if (to != sc.offset) sc.jumpTo(to);
  }

  Future<void> _dragEnd() async {
    if (dragId == null) return; // もう終わっている
    autoScroll?.cancel();
    autoScroll = null;
    final w = work;
    setState(() => dragId = null);
    if (w == null) return;
    final s = AppScope.read(context);
    final before = widget.products.map((p) => p['id']).join(',');
    if (w.map((p) => p['id']).join(',') != before) {
      await s.reorderProducts(w);
      Sound.play(Sfx.add);
    }
    if (mounted) setState(() => work = null);
  }

  /// ほかの商品の上に来たら、その場所へ動かす（まわりの商品はずれる）
  bool _hover(String id, Json target) {
    final w = work;
    if (w == null || id == target['id']) return false;
    final from = w.indexWhere((p) => p['id'] == id);
    final to = w.indexWhere((p) => p['id'] == target['id']);
    if (from < 0 || to < 0) return false;
    setState(() {
      final x = w.removeAt(from);
      w.insert(to, x);
    });
    HapticFeedback.selectionClick();
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final list = work ?? widget.products;
    // 案内は商品の上に重ねて出す（出たときに商品の並びがずれて、指の位置と合わなくならないように）
    return Stack(
      children: [
        Positioned.fill(
          // 指を離したら終わり（動かしている商品が画面の外へスクロールしても確実に保存する）
          child: Listener(
            onPointerUp: (_) => _dragEnd(),
            onPointerCancel: (_) => _dragEnd(),
            child: GridView.builder(
              key: gridKey,
              controller: sc,
              padding: EdgeInsets.fromLTRB(12, 4, 12, editing ? 80 : 12),
              gridDelegate: SliverGridDelegateWithMaxCrossAxisExtent(maxCrossAxisExtent: widget.tablet ? 180 : 150, mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.25),
              itemCount: list.length,
              // 並びが変わっても、それぞれの商品のボタン（動かしている最中の状態）を作り直さない
              findChildIndexCallback: (key) {
                final id = (key as ValueKey<String>).value.substring(5);
                final i = list.indexWhere((p) => p['id'] == id);
                return i < 0 ? null : i;
              },
              itemBuilder: (c, i) => KeyedSubtree(key: ValueKey<String>('cell-${list[i]['id']}'), child: _item(list[i], i)),
            ),
          ),
        ),
        if (editing)
          Positioned(
            left: 0,
            right: 0,
            bottom: 8,
            child: Container(
              key: const ValueKey('reorderBar'),
              margin: const EdgeInsets.symmetric(horizontal: 12),
              padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
              decoration: BoxDecoration(
                color: const Color(0xFFF7E3DC),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: accent),
                boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 8)],
              ),
              child: Row(
                children: [
                  const Icon(Icons.open_with, color: accent, size: 20),
                  const SizedBox(width: 8),
                  const Expanded(
                    child: Text('並べ替え中：商品を押したまま、置きたい場所へ動かしてください', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                  ),
                  FilledButton(key: const ValueKey('reorderDone'), onPressed: _stopEditing, child: const Text('完了')),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _item(Json p, int i) {
    final id = p['id'] as String;
    final tile = ProductTile(p: p, count: widget.counts[p['id']] ?? 0, onTap: editing ? () {} : () => widget.onTap(p));
    if (!widget.canReorder) return tile;
    return LayoutBuilder(
      builder: (c, box) {
        final size = Size(box.maxWidth, box.maxHeight);
        // 並べ替え中は、ぷるぷると小さく揺れる
        final shown = editing && dragId != id
            ? AnimatedBuilder(
                animation: wiggle,
                builder: (c, child) => Transform.rotate(angle: (wiggle.value - 0.5) * 0.045 * (i.isEven ? 1 : -1), child: child),
                child: tile,
              )
            : tile;
        final feedback = Material(
          color: Colors.transparent,
          child: SizedBox.fromSize(
            size: size,
            child: Transform.scale(
              scale: 1.08,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: const [BoxShadow(color: Color(0x55000000), blurRadius: 14, offset: Offset(0, 6))],
                ),
                child: ProductTile(p: p, count: widget.counts[p['id']] ?? 0, onTap: () {}),
              ),
            ),
          ),
        );
        final ghost = Opacity(opacity: 0.25, child: tile);
        void update(DragUpdateDetails d) => lastPos = d.globalPosition;
        // 型を変えると動かしている最中に作り直されてしまうので、いつも LongPressDraggable を使い、
        // 並べ替え中は押してすぐ動かせるように待ち時間を短くする
        final draggable = LongPressDraggable<String>(
          key: ValueKey('drag-$id'),
          data: id,
          delay: editing ? const Duration(milliseconds: 120) : const Duration(milliseconds: 500),
          feedback: feedback,
          childWhenDragging: ghost,
          hapticFeedbackOnStart: false,
          onDragStarted: () => _dragStart(p),
          onDragUpdate: update,
          onDragEnd: (_) => _dragEnd(),
          child: shown,
        );
        return DragTarget<String>(
          onWillAcceptWithDetails: (d) {
            _hover(d.data, p);
            return true;
          },
          builder: (c, cand, rej) => draggable,
        );
      },
    );
  }
}
