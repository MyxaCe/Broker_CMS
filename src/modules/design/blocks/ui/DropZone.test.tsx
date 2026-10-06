import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { DropZone } from './DropZone'

import type { EditorBlock } from './tree-ops'

/**
 * Зона приёма — разметкой.
 *
 * Запреты переноса проверены в `tree-ops.test.ts` целиком. Здесь другое: что
 * зона **спрашивает** у них разрешение и показывает отказ до отпускания
 * кнопки. Зона, которая принимает всё и молчит, прошла бы все те тесты —
 * дерево починилось бы уже после отпускания, а редактор увидел бы, что блок
 * «не перетащился».
 */

const TREE: EditorBlock[] = [
  { type: 'quote', props: { text: 'раз' } },
  { type: 'columns', variant: 'two', props: {}, slots: { columns: [] } },
]

function render(dragging: (number | string)[] | null, listPath: (number | string)[]): string {
  return renderToStaticMarkup(
    <ol>
      <DropZone
        tree={TREE}
        dragging={dragging}
        listPath={listPath}
        index={0}
        onDrop={() => undefined}
      />
    </ol>,
  )
}

describe('зона приёма', () => {
  it('не существует, пока ничего не тащат', () => {
    expect(render(null, [])).not.toContain('block-drop')
  })

  it('разрешённая зона отказа не показывает', () => {
    const html = render([0], [1, 'columns'])

    expect(html).toContain('data-testid="block-drop"')
    expect(html).not.toContain('block-tree__drop--refused')
  })

  it('запрещённая зона помечена и называет причину до отпускания', () => {
    const html = render([1], [1, 'columns'])

    expect(html).toContain('block-tree__drop--refused')
    expect(html).toContain('в самого себя')
  })

  it('чужой слот отказывает своей причиной, а не общей', () => {
    expect(render([1], [0, 'columns'])).toContain('не принимает')
  })
})
