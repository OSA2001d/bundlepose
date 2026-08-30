(() => {
  "use strict";
  document.querySelectorAll(".bqb").forEach((banner) => {
    const button = banner.querySelector("[data-bqb-copy]");
    const prompt = banner.querySelector("[data-bqb-prompt]");
    if (!button || !prompt) return;
    button.addEventListener("click", async () => {
      const text = prompt.textContent.trim().replace(/^"|"$/g, "");
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
        button.classList.add("copied");
        setTimeout(() => {
          button.textContent = "Copy";
          button.classList.remove("copied");
        }, 2000);
      } catch {
        // Clipboard unavailable (permissions): select the text instead.
        const range = document.createRange();
        range.selectNodeContents(prompt);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    });
  });
})();
