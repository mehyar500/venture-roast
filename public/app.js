/* RoastMe frontend — no dependencies. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var dropzone = $("dropzone"), fileInput = $("fileInput"), previewWrap = $("previewWrap"),
      preview = $("preview"), roastBtn = $("roastBtn"), loading = $("loading"),
      loadLine = $("loadLine"), hero = $("hero"), teaserSec = $("teaser"),
      fullSec = $("fullcard");

  var photoDataUrl = null;   // downscaled data URL, also used for the PNG card
  var currentRoastId = null;
  var currentMode = "savage";
  var paidToken = null;

  /* ---------- analytics (privacy-friendly: no cookies, no fingerprinting) ---------- */
  function track(event, extra) {
    try {
      var ref = null;
      try { ref = sessionStorage.getItem("roastme_ref"); } catch (e) {}
      var body = JSON.stringify(Object.assign(
        { event: event, roast_id: currentRoastId, ref: ref }, extra || {}));
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/event", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/event", { method: "POST", headers: { "content-type": "application/json" }, body: body, keepalive: true });
      }
    } catch (e) { /* never break the product */ }
  }
  function getRef() {
    try { return sessionStorage.getItem("roastme_ref"); } catch (e) { return null; }
  }

  /* ---------- paid-return pages stay out of search indexes ---------- */
  function qs(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }
  if (qs("paid") === "1") {
    var meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
  }

  /* ---------- roast mode pills ---------- */
  var pills = document.querySelectorAll(".mode-pill");
  pills.forEach(function (pill) {
    pill.addEventListener("click", function () {
      pills.forEach(function (p) {
        p.classList.remove("active");
        p.setAttribute("aria-checked", "false");
      });
      pill.classList.add("active");
      pill.setAttribute("aria-checked", "true");
      currentMode = pill.getAttribute("data-mode") || "savage";
    });
  });

  /* ---------- upload ---------- */
  function showUploadErr(msg) {
    var err = $("uploadErr");
    err.textContent = msg;
    err.classList.remove("hidden");
  }
  function hideUploadErr() { $("uploadErr").classList.add("hidden"); }

  dropzone.addEventListener("click", function () { fileInput.click(); });
  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  ["dragover", "dragenter"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove("over"); });
  });
  dropzone.addEventListener("drop", function (e) {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
  });
  $("changeBtn").addEventListener("click", function () { fileInput.click(); });

  function handleFile(file) {
    hideUploadErr();
    if (!/^image\//.test(file.type)) { showUploadErr("That is not a photo. Try again, champ."); return; }
    if (file.size > 15 * 1024 * 1024) { showUploadErr("Photo is huge — pick one under 15MB."); return; }
    track("upload_started", {});
    var img = new Image();
    img.onload = function () {
      // Downscale to max 1024px to keep the AI payload small.
      var max = 1024, w = img.width, h = img.height;
      if (Math.max(w, h) > max) {
        var s = max / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      photoDataUrl = c.toDataURL("image/jpeg", 0.85);
      preview.src = photoDataUrl;
      dropzone.classList.add("hidden");
      var tip = document.querySelector(".dz-tip");
      if (tip) tip.classList.add("hidden");
      previewWrap.classList.remove("hidden");
      roastBtn.disabled = false;
      URL.revokeObjectURL(img.src);
    };
    img.onerror = function () { showUploadErr("Could not read that image. Try another one."); };
    img.src = URL.createObjectURL(file);
  }

  /* ---------- roast ---------- */
  var LOAD_LINES = [
    "Reading your life choices…",
    "Zooming in on that haircut…",
    "Consulting the council of petty judges…",
    "Analyzing questionable fashion decisions…",
    "Sharpening the insults…",
    "Almost done being mean (lovingly)…"
  ];

  var loadTimer = null, progressTimer = null;
  roastBtn.addEventListener("click", function () {
    if (!photoDataUrl) return;
    hideUploadErr();
    roastBtn.disabled = true;
    loading.classList.remove("hidden");
    track("roast_requested", { mode: currentMode });
    var i = 0;
    loadLine.textContent = LOAD_LINES[0];
    loadTimer = setInterval(function () {
      i = (i + 1) % LOAD_LINES.length;
      loadLine.textContent = LOAD_LINES[i];
    }, 1600);
    // Determinate-ish progress: ease toward 95% over ~45s, complete on response.
    var bar = $("progressBar"), p = 0;
    if (bar) {
      bar.style.width = "4%";
      progressTimer = setInterval(function () {
        p = Math.min(95, p + (95 - p) * 0.06 + 0.4);
        bar.style.width = p.toFixed(1) + "%";
      }, 500);
    }

    function done() {
      clearInterval(loadTimer); clearInterval(progressTimer);
      if (bar) bar.style.width = "100%";
      setTimeout(function () { loading.classList.add("hidden"); if (bar) bar.style.width = "4%"; }, 250);
    }

    postJSON("/api/roast", { image: photoDataUrl, mode: currentMode }).then(function (res) {
      done();
      if (!res.ok) {
        roastBtn.disabled = false;
        track("roast_failed", { error: res.error || "unknown" });
        showUploadErr(res.error === "rate_limited"
          ? "Easy, tiger — 5 roasts an hour. Come back soon."
          : "The AI choked on that photo. Try a clearer one.");
        return;
      }
      currentRoastId = res.roast_id;
      track("roast_ok", { mode: currentMode });
      renderTeaser(res.teaser, res.lines);
    }).catch(function () {
      done();
      roastBtn.disabled = false;
      track("roast_failed", { error: "network" });
      showUploadErr("Something went wrong. The roast gods are displeased — try again.");
    });
  });

  function renderTeaser(teaser, lineCount) {
    $("teaserPhoto").src = photoDataUrl;
    $("teaserLines").textContent = teaser;
    var locked = Math.max(0, (lineCount || 0) - 2);
    $("lineCount").textContent = locked + " more lines";
    // Fake locked lines behind the blur so the card looks full.
    $("lockedLines").textContent = "Your poor choices continue here\nand here\nand honestly it gets worse\nfrom this point on";
    hero.classList.add("hidden");
    teaserSec.classList.remove("hidden");
    teaserSec.scrollIntoView({ behavior: "smooth" });
    track("teaser_viewed", {});
  }

  /* ---------- email capture + checkout ---------- */
  $("payBtn").addEventListener("click", function () {
    var email = $("emailInput").value.trim().toLowerCase();
    var giftEmail = $("giftInput").value.trim().toLowerCase();
    var err = $("payErr");
    err.classList.add("hidden");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      err.textContent = "That email looks fake. Even our roasts are more real.";
      err.classList.remove("hidden");
      return;
    }
    if (giftEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(giftEmail)) {
      err.textContent = "The gift email looks fake. Check it and try again.";
      err.classList.remove("hidden");
      return;
    }
    var btn = $("payBtn");
    btn.disabled = true; btn.textContent = "Working…";
    track("pay_clicked", {});
    postJSON("/api/capture", { email: email, roast_id: currentRoastId, gift_email: giftEmail || undefined }).then(function (capRes) {
      if (capRes && capRes.unsub_url) {
        var note = $("captureNote");
        if (note) {
          var safeUrl = String(capRes.unsub_url).replace(/"/g, "");
          note.innerHTML = 'Receipt + card link go to your email. Secure checkout via Stripe. <a href="' + safeUrl + '">Unsubscribe anytime</a>.';
        }
      }
      if (capRes && capRes.error === "disposable_email") throw new Error("disposable_email");
      track("checkout_started", {});
      return postJSON("/api/checkout", {
        email: email, roast_id: currentRoastId,
        gift_email: giftEmail || undefined, ref: getRef() || undefined
      });
    }).then(function (res) {
      if (res.ok && res.checkout_url) {
        window.location = res.checkout_url;
      } else {
        throw new Error("checkout_failed");
      }
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = "Unlock — $5";
      err.textContent = (e && e.message === "disposable_email")
        ? "Throwaway emails get roasted harder. Use a real one."
        : "Checkout hiccup. Try again — the burn can wait 30 seconds.";
      err.classList.remove("hidden");
    });
  });

  /* ---------- post-payment unlock ---------- */
  paidToken = qs("access_token");
  if (qs("paid") === "1" && paidToken) {
    hero.classList.add("hidden");
    $("paidBanner").classList.remove("hidden");
    fetch("/api/unlock?token=" + encodeURIComponent(paidToken)).then(function (r) { return r.json(); })
      .then(function (res) {
        $("paidBanner").classList.add("hidden");
        if (res.ok) {
          track("unlocked", { mode: res.mode });
          renderFull(res.roast_text, res.roast_id);
        } else {
          $("paidBanner").classList.remove("hidden");
          $("paidBanner").textContent = "Payment not confirmed yet — if you just paid, wait a few seconds and refresh.";
        }
      }).catch(function () {
        $("paidBanner").textContent = "Could not confirm payment. Refresh in a few seconds.";
      });
  } else if (qs("canceled") === "1") {
    $("cancelBanner").classList.remove("hidden");
    $("retryBtn").addEventListener("click", function () {
      window.location = window.location.pathname;
    });
  }

  function renderFull(roastText, roastId) {
    if (photoDataUrl) $("fullPhoto").src = photoDataUrl;
    else $("fullPhoto").parentElement.style.display = "none";
    $("fullLines").textContent = roastText;
    if (roastId) {
      currentRoastId = roastId;
      $("cardFoot").textContent = "roast.mehyar.us/r/" + roastId + " — get roasted";
    }
    teaserSec.classList.add("hidden");
    fullSec.classList.remove("hidden");
    fullSec.scrollIntoView({ behavior: "smooth" });
    window._roastText = roastText;
    window._roastId = roastId;
    setupGift(roastId);
  }

  $("againBtn").addEventListener("click", function () { window.location = window.location.pathname; });

  /* ---------- share card (canvas) ---------- */
  function drawCard(photoImg) {
    return new Promise(function (resolve) {
      var text = window._roastText || "";
      var roastId = window._roastId || "";
      var W = 1080, pad = 70;
      var c = document.createElement("canvas");
      c.width = W;
      var ctx = c.getContext("2d");

      ctx.font = "900 34px Arial";
      var photoH = 0;
      if (photoImg) {
        var pw = W - pad * 2, ph = Math.round(pw * photoImg.height / photoImg.width);
        photoH = Math.min(ph, 640) + 30;
      }
      ctx.font = "17px Arial";
      var lines = wrapLines(ctx, text, W - pad * 2);
      var lineH = 34;
      var textH = lines.length * lineH;
      var H = pad + 60 + photoH + textH + 120;
      c.height = H;

      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#241a12"); g.addColorStop(1, "#14100c");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      var y = pad;
      ctx.font = "900 34px Arial"; ctx.fillStyle = "#ffc531";
      ctx.fillText("🔥 ROASTME", pad, y + 30); y += 60;
      if (photoImg) {
        var pw2 = W - pad * 2, ph2 = Math.round(pw2 * photoImg.height / photoImg.width);
        var dh = Math.min(ph2, 640);
        var sw = photoImg.width, sh = Math.round(sw * dh / pw2);
        var sy = Math.max(0, Math.round((photoImg.height - sh) / 2));
        ctx.drawImage(photoImg, 0, sy, sw, sh, pad, y, pw2, dh);
        y += dh + 30;
      }
      ctx.font = "26px Arial"; ctx.fillStyle = "#f5efe6";
      lines.forEach(function (ln) { ctx.fillText(ln, pad, y); y += lineH; });
      ctx.font = "20px Arial"; ctx.fillStyle = "#a89c8c";
      ctx.textAlign = "center";
      // Deep link: every shared card points at its public roast page.
      ctx.fillText(roastId ? ("roast.mehyar.us/r/" + roastId + " — get roasted") : "roast.mehyar.us — share the burn", W / 2, H - 50);
      ctx.textAlign = "left";
      c.toBlob(function (blob) { resolve(blob); }, "image/png");
    });
  }

  function getCardBlob() {
    return new Promise(function (resolve) {
      function done(img) { drawCard(img).then(resolve); }
      if (photoDataUrl) {
        var img = new Image();
        img.onload = function () { done(img); };
        img.onerror = function () { done(null); };
        img.src = photoDataUrl;
      } else { done(null); }
    });
  }

  // Native share sheet on mobile (the viral loop), download fallback.
  $("shareBtn").addEventListener("click", function () {
    var btn = $("shareBtn");
    btn.disabled = true; btn.textContent = "Making the card…";
    getCardBlob().then(function (blob) {
      btn.disabled = false; btn.textContent = "📤 Share your roast";
      if (!blob) return;
      var roastId = window._roastId || "";
      var file = new File([blob], "roastme-card.png", { type: "image/png" });
      var shareUrl = roastId ? "https://roast.mehyar.us/r/" + roastId : "https://roast.mehyar.us/";
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: "My RoastMe card", text: "I got roasted 🔥 — your turn.", url: shareUrl })
          .then(function () { track("shared", { via: "native" }); })
          .catch(function () { /* user dismissed */ });
      } else {
        downloadBlob(blob);
        track("shared", { via: "download_fallback" });
      }
    });
  });

  $("downloadBtn").addEventListener("click", function () {
    getCardBlob().then(function (blob) {
      if (blob) { downloadBlob(blob); track("downloaded", {}); }
    });
  });

  function downloadBlob(blob) {
    var a = document.createElement("a");
    a.download = "roastme-card.png";
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  function wrapLines(ctx, text, maxW) {
    var out = [];
    text.split("\n").forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), cur = "";
      words.forEach(function (w) {
        var t = cur ? cur + " " + w : w;
        if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; }
        else cur = t;
      });
      if (cur) out.push(cur);
      out.push(""); // paragraph gap
    });
    return out;
  }

  /* ---------- gift panel ---------- */
  function setupGift(roastId) {
    var giftBtn = $("giftBtn"), panel = $("giftPanel");
    if (!paidToken || !roastId) { giftBtn.classList.add("hidden"); return; }
    var link = "https://roast.mehyar.us/?paid=1&access_token=" + paidToken;
    $("giftLink").value = link;
    var giftEmail = ($("giftInput") && $("giftInput").value.trim()) || "";
    $("giftMsg").value =
      (giftEmail ? "Hey! " : "Hey — ") +
      "I paid $5 to have a robot roast " + (giftEmail ? "you" : "me") +
      " and it did NOT hold back. 🔥\n\n" +
      "Open the card here (it's yours now):\n" + link +
      "\n\nNo take-backs. — via RoastMe";
    giftBtn.addEventListener("click", function () {
      panel.classList.toggle("hidden");
      track("gift_opened", {});
    });
    function copyText(el, btn, label) {
      el.select();
      var done = function () {
        var old = btn.textContent;
        btn.textContent = "Copied ✓";
        setTimeout(function () { btn.textContent = old; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(el.value).then(done).catch(function () {
          document.execCommand("copy"); done();
        });
      } else { document.execCommand("copy"); done(); }
    }
    $("giftCopyLink").addEventListener("click", function () { copyText($("giftLink"), $("giftCopyLink")); });
    $("giftCopyMsg").addEventListener("click", function () { copyText($("giftMsg"), $("giftCopyMsg")); });
  }

  function postJSON(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }
})();
