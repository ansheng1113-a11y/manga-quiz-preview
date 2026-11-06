export function createAutoAdvance(advance) {
  let timer;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    cancel,
    schedule() {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        advance();
      }, 350);
    }
  };
}
