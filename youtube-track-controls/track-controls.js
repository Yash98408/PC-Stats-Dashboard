(() => {
  if (!navigator.mediaSession) return;
  const music = location.hostname === "music.youtube.com";
  const selectors = music
    ? {nexttrack: "ytmusic-player-bar .next-button", previoustrack: "ytmusic-player-bar .previous-button"}
    : {nexttrack: "#movie_player .ytp-next-button", previoustrack: "#movie_player .ytp-prev-button"};
  const installed = new Set();
  function buttonFor(action) {
    const button = document.querySelector(selectors[action]);
    if (!button || button.disabled || button.hasAttribute("disabled") ||
        button.getAttribute("aria-disabled") === "true" || !button.getClientRects().length) return null;
    const style = getComputedStyle(button);
    return style.visibility === "hidden" || style.display === "none" ? null : button;
  }
  function sync() {
    const video = document.querySelector(music ? "ytmusic-player video" : "#movie_player video");
    for (const action of Object.keys(selectors)) {
      if (video && video.currentSrc && buttonFor(action)) {
        navigator.mediaSession.setActionHandler(action, () => {
          const button = buttonFor(action);
          if (button) button.click();
        });
        installed.add(action);
      } else if (installed.delete(action)) {
        navigator.mediaSession.setActionHandler(action, null);
      }
    }
  }
  // YouTube reuses its page and can replace its media handlers on track changes.
  document.addEventListener("playing", sync, true);
  document.addEventListener("yt-navigate-finish", sync);
  setInterval(sync, 2000);
  sync();
})();
