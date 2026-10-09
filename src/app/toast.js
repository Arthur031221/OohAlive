export function createToast(node) {
  let timer = 0
  return (message, duration = 3600) => {
    node.textContent = message
    node.classList.add('show')
    clearTimeout(timer)
    timer = setTimeout(() => node.classList.remove('show'), duration)
  }
}
