/**
 * Заглушка контекста формы Payload для тестов клиентских компонентов.
 *
 * Почему она вообще появилась. Клиентские компоненты у нас не покрывались
 * ([[DEBT-018]]), и причина была названа верно: поднять контекст формы вне
 * админки дороже, чем стоит один компонент, а тяжёлый харнесс приводит к
 * тому, что тесты перестают гонять. Решение не отменено — пересчитано.
 * Компонентов теперь шесть, а харнесс оказался вот таким: два десятка строк
 * без DOM, без браузера и без библиотеки тестирования компонентов.
 *
 * **Что он проверяет и чего не проверяет.** Разметку первого рендера — и
 * только её. Нажатия, эффекты и запросы здесь не происходят: эффекты при
 * серверном рендере не выполняются вовсе. Это сознательная граница. Ловится
 * ровно тот класс, который не ловится ничем другим: «функция написана и не
 * вызывается» — когда решение принято в чистом модуле, покрыто тестами и не
 * подключено к компоненту. Такая дыра даёт зелёный прогон и пустой экран.
 *
 * Поведение при нажатии по-прежнему не покрыто, и это сказано вслух, а не
 * подразумевается.
 */

interface FieldState {
  readonly value: unknown
}

/**
 * Состояние поддельной формы. Общее на модуль — так же, как настоящее
 * состояние формы общее на документ. Тест обязан звать `resetAdminForm`
 * перед каждым случаем: иначе первый прогон зелёный, а второй читает чужое
 * значение.
 */
export const adminForm: {
  value: unknown
  setValueCalls: unknown[]
  fields: Record<string, FieldState>
  addedRows: unknown[]
} = {
  value: undefined,
  setValueCalls: [],
  fields: {},
  addedRows: [],
}

export function resetAdminForm(value?: unknown): void {
  adminForm.value = value
  adminForm.setValueCalls = []
  adminForm.fields = {}
  adminForm.addedRows = []
}

export function useField<T>(_args: { path: string }): {
  value: T
  setValue: (next: unknown) => void
} {
  return {
    value: adminForm.value as T,
    setValue: (next: unknown) => {
      adminForm.setValueCalls.push(next)
    },
  }
}

export function useForm(): { addFieldRow: (args: unknown) => void } {
  return {
    addFieldRow: (args: unknown) => {
      adminForm.addedRows.push(args)
    },
  }
}

export function useFormFields<T>(selector: (args: [Record<string, FieldState>]) => T): T {
  return selector([adminForm.fields])
}
