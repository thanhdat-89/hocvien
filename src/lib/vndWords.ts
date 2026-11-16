const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']
const SCALES = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ']

/** Đọc nhóm 3 chữ số; `full` = không phải nhóm đầu nên phải đọc cả "không trăm", "lẻ". */
function readTriple(n: number, full: boolean) {
  const h = Math.floor(n / 100), t = Math.floor(n / 10) % 10, u = n % 10
  const words: string[] = []
  if (full || h) words.push(DIGITS[h], 'trăm')
  if (t > 1) {
    words.push(DIGITS[t], 'mươi')
    if (u) words.push(u === 1 ? 'mốt' : u === 4 ? 'tư' : u === 5 ? 'lăm' : DIGITS[u])
  } else if (t === 1) {
    words.push('mười')
    if (u) words.push(u === 5 ? 'lăm' : DIGITS[u])
  } else if (u) {
    if (full || h) words.push('lẻ')
    words.push(DIGITS[u])
  }
  return words.join(' ')
}

/** Số tiền bằng chữ theo cách ghi trên hoá đơn MISA, ví dụ 1400000 → "Một triệu bốn trăm nghìn đồng chẵn." */
export function vndInWords(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount >= 1e15) return ''
  if (amount === 0) return 'Không đồng.'
  const groups: number[] = []
  for (let n = amount; n > 0; n = Math.floor(n / 1000)) groups.push(n % 1000)
  const words = groups.map((group, index) => ({ group, index })).reverse()
    .filter(({ group }) => group > 0)
    .map(({ group, index }) => [readTriple(group, index < groups.length - 1), SCALES[index]].filter(Boolean).join(' '))
    .join(' ')
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} đồng chẵn.`
}
