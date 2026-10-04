/* Device share sheet (AirDrop / Messages on iOS) with copy-link fallback.
   Sharing the URL is not an access grant — the gateway still checks invite + CIDR. */
(function () {
  function legacyCopy(text) {
    var field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text).catch(function () {
        legacyCopy(text);
      });
    }
    legacyCopy(text);
    return Promise.resolve();
  }

  function setStatus(message) {
    var live = document.querySelector("[data-share-status]");
    if (live) live.textContent = message;
  }

  function shareUrlFrom(node) {
    if (!node) return "";
    return (
      node.getAttribute("data-share-url") ||
      (document.querySelector("[data-share-url-value]") || {}).value ||
      ""
    );
  }

  function sharePayload(node, url) {
    return {
      title: (node && node.getAttribute("data-share-title")) || "Private share",
      text: (node && node.getAttribute("data-share-text")) || "",
      url: url,
    };
  }

  function openShare(node) {
    var url = shareUrlFrom(node);
    if (!url) return;
    var payload = sharePayload(node, url);
    if (typeof navigator.share === "function") {
      navigator.share(payload).then(
        function () {
          setStatus("Opened the device share sheet");
        },
        function () {
          /* user cancelled */
        },
      );
      return;
    }
    copyText(url).then(function () {
      setStatus("Link copied");
    });
  }

  document.documentElement.dataset.canShare = typeof navigator.share === "function" ? "1" : "0";

  document.addEventListener("click", function (event) {
    var shareBtn = event.target.closest("[data-share]");
    var copyBtn = event.target.closest("[data-copy]");
    if (!shareBtn && !copyBtn) return;
    var url = shareUrlFrom(shareBtn || copyBtn);
    if (!url) return;
    event.preventDefault();

    if (shareBtn) {
      openShare(shareBtn);
      return;
    }

    copyText(url).then(function () {
      setStatus("Link copied");
    });
  });

  var auto = document.querySelector("[data-auto-share]");
  if (auto) {
    openShare(auto);
  }
})();
