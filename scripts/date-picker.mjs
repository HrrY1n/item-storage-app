/** Shared UI driver for the confirmed date picker; no direct form-state writes. */
export async function setDateDraft(session, date) {
  const parts = date.split('-').map(Number)
  for (const [index, label] of ['年', '月', '日'].entries()) {
    await session.ev(`(() => {
      const select = document.querySelector('[data-date-picker] select[aria-label=${JSON.stringify(label)}]');
      if (!select) throw new Error('Date picker is not open');
      select.value = ${parts[index]};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
  }
}

export async function selectDate(session, label, date) {
  await session.ev(`document.querySelector('button[data-date-field=${JSON.stringify(label)}]').click()`)
  await setDateDraft(session, date)
  await session.ev(`[...document.querySelectorAll('[data-date-picker] button')].find(b => b.textContent === '确定').click()`)
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!await session.ev(`!!document.querySelector('[data-date-picker]')`)) break
    if (attempt === 39) throw new Error('Date picker did not finish closing')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return session.ev(`document.querySelector('button[data-date-field=${JSON.stringify(label)}]').dataset.dateValue`)
}
