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

  var LOAD_LINES = [
    "Reading your life choices…",
    "Zooming in on that haircut…",
    "Consulting the council of petty judges…",
    "Analyzing questionable fashion decisions…",
    "Sharpening the insults…",
    "Almost done being mean (lovingly)…"
  ];

  /* ---------- upload ---------- */
  dropzone.addEventListener("click", function () { fileInput.click(); });
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
    if (!/^image\//.test(file.type)) { alert("That is not a photo. Try again, champ."); return; }
    if (file.size > 15 * 1024 * 1024) { alert("Photo is huge — pick one under 15MB."); return; }
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
      previewWrap.classList.remove("hidden");
      roastBtn.disabled = false;
      URL.revokeObjectURL(img.src);
    };
    img.onerror = function () { alert("Could not read that image."); };
    img.src = URL.createObjectURL(file);
  }

  /* ---------- roast ---------- */
  var loadTimer = null;
  roastBtn.addEventListener("click", function () {
    if (!photoDataUrl) return;
    roastBtn.disabled = true;
    loading.classList.remove("hidden");
    var i = 0;
    loadLine.textContent = LOAD_LINES[0];
    loadTimer = setInterval(function () {
      i = (i + 1) % LOAD_LINES.length;
      loadLine.textContent = LOAD_LINES[i];
    }, 1600);

    postJSON("/api/roast", { image: photoDataUrl }).then(function (res) {
      clearInterval(loadTimer);
      loading.classList.add("hidden");
      if (!res.ok) {
        roastBtn.disabled = false;
        alert("The AI choked on that photo. Try a clearer one.");
        return;
      }
      currentRoastId = res.roast_id;
      renderTeaser(res.teaser, res.lines);
    }).catch(function () {
      clearInterval(loadTimer);
      loading.classList.add("hidden");
      roastBtn.disabled = false;
      alert("Something went wrong. The roast gods are displeased.");
    });
  });

  function renderTeaser(teaser, lineCount) {
    $("teaserPhoto").src = photoDataUrl;
    $("teaserLines").textContent = teaser;
    $("lineCount").textContent = lineCount + " more lines";
    // Fake locked lines behind the blur so the card looks full.
    $("lockedLines").textContent = "Your poor choices continue here\nand here\nand honestly it gets worse\nfrom this point on";
    hero.classList.add("hidden");
    teaserSec.classList.remove("hidden");
    teaserSec.scrollIntoView({ behavior: "smooth" });
  }

  /* ---------- email capture + checkout ---------- */
  $("payBtn").addEventListener("click", function () {
    var email = $("emailInput").value.trim().toLowerCase();
    var err = $("payErr");
    err.classList.add("hidden");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      err.textContent = "That email looks fake. Even our roasts are more real.";
      err.classList.remove("hidden");
      return;
    }
    var btn = $("payBtn");
    btn.disabled = true; btn.textContent = "Working…";
    postJSON("/api/capture", { email: email, roast_id: currentRoastId }).then(function (capRes) {
      if (capRes && capRes.unsub_url) {
        var note = $("captureNote");
        if (note) {
          var safeUrl = String(capRes.unsub_url).replace(/"/g, "");
          note.innerHTML = 'Receipt + card link go to your email. Secure checkout via Stripe. <a href="' + safeUrl + '">Unsubscribe anytime</a>.';
        }
      }
      return postJSON("/api/checkout", { email: email, roast_id: currentRoastId });
    }).then(function (res) {
      if (res.ok && res.checkout_url) {
        window.location = res.checkout_url;
      } else {
        throw new Error("checkout_failed");
      }
    }).catch(function () {
      btn.disabled = false; btn.textContent = "Unlock — $5";
      err.textContent = "Checkout hiccup. Try again — the burn can wait 30 seconds.";
      err.classList.remove("hidden");
    });
  });

  /* ---------- post-payment unlock ---------- */
  function qs(name) {
    var m = new RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  var paidToken = qs("access_token");
  if (qs("paid") === "1" && paidToken) {
    hero.classList.add("hidden");
    $("paidBanner").classList.remove("hidden");
    fetch("/api/unlock?token=" + encodeURIComponent(paidToken)).then(function (r) { return r.json(); })
      .then(function (res) {
        $("paidBanner").classList.add("hidden");
        if (res.ok) {
          renderFull(res.roast_text);
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

  function renderFull(roastText) {
    // Reuse the uploaded photo if this is the same session; otherwise the
    // card still renders with the roast text (photo optional).
    if (photoDataUrl) $("fullPhoto").src = photoDataUrl;
    else $("fullPhoto").parentElement.style.display = "none";
    $("fullLines").textContent = roastText;
    teaserSec.classList.add("hidden");
    fullSec.classList.remove("hidden");
    fullSec.scrollIntoView({ behavior: "smooth" });
    window._roastText = roastText;
  }

  $("againBtn").addEventListener("click", function () { window.location = window.location.pathname; });

  /* ---------- PNG download ---------- */
  $("downloadBtn").addEventListener("click", function () {
    var text = window._roastText || "";
    var W = 1080, pad = 70;
    var c = document.createElement("canvas");
    c.width = W;
    var ctx = c.getContext("2d");

    function drawCard(photoImg) {
      var y = pad;
      // Background
      var g = ctx.createLinearGradient(0, 0, 0, 2000);
      g.addColorStop(0, "#241a12"); g.addColorStop(1, "#14100c");
      ctx.fillStyle = g;

      // Layout: measure first with a tall canvas, then redraw.
      var photoH = 0;
      if (photoImg) {
        var pw = W - pad * 2, ph = Math.round(pw * photoImg.height / photoImg.width);
        photoH = Math.min(ph, 640) + 30;
      }
      ctx.font = "900 34px Arial";
      ctx.fillStyle = "#ffc531";
      var brandH = 60;
      ctx.font = "17px Arial";
      var lines = wrapLines(ctx, text, W - pad * 2);
      var lineH = 34;
      var textH = lines.length * lineH;
      var H = pad + brandH + photoH + textH + 120;
      c.height = H;

      // Redraw on final size.
      g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#241a12"); g.addColorStop(1, "#14100c");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      y = pad;
      ctx.font = "900 34px Arial"; ctx.fillStyle = "#ffc531";
      ctx.fillText("🔥 ROASTME", pad, y + 30); y += brandH;
      if (photoImg) {
        var pw2 = W - pad * 2, ph2 = Math.round(pw2 * photoImg.height / photoImg.width);
        var dh = Math.min(ph2, 640);
        // cover-fit crop vertically centered
        var sw = photoImg.width, sh = Math.round(sw * dh / pw2);
        var sy = Math.max(0, Math.round((photoImg.height - sh) / 2));
        ctx.drawImage(photoImg, 0, sy, sw, sh, pad, y, pw2, dh);
        y += dh + 30;
      }
      ctx.font = "26px Arial"; ctx.fillStyle = "#f5efe6";
      lines.forEach(function (ln) { ctx.fillText(ln, pad, y); y += lineH; });
      ctx.font = "20px Arial"; ctx.fillStyle = "#a89c8c";
      ctx.textAlign = "center";
      ctx.fillText("roast.mehyar.us — share the burn", W / 2, H - 50);
      ctx.textAlign = "left";

      var a = document.createElement("a");
      a.download = "roastme-card.png";
      a.href = c.toDataURL("image/png");
      a.click();
    }

    if (photoDataUrl) {
      var img = new Image();
      img.onload = function () { drawCard(img); };
      img.onerror = function () { drawCard(null); };
      img.src = photoDataUrl;
    } else {
      drawCard(null);
    }
  });

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

  function postJSON(url, body) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }
})();
