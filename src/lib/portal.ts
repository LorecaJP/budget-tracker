// モーダルを body 直下へ移動する Svelte アクション。
// アプリシェル化で .content が内部スクロール領域になり、iOS ではそこが独自の
// 重なり順（stacking context）を作る。その中で開いたモーダル（例：取引画面から開く
// 給与PDF取込）は、.content の外にある固定タブバー/FABの下に潜って見えなくなる。
// use:portal で body 直下へ出すことで、モーダルを常に最前面に表示する。
export function portal(node: HTMLElement) {
  document.body.appendChild(node)
  return {
    destroy() { node.parentNode?.removeChild(node) },
  }
}
