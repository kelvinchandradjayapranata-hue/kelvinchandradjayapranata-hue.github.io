/* ==========================================================================
   Homepage site guide - a small fixed-answer assistant.

   Every reply below is written from this site's own public pages. Matching
   happens locally in the browser: there is no API, no server request, no
   storage, and no third-party script. The launcher and panel begin hidden
   in the markup and are revealed only by this file, so scripting-disabled
   visitors never see a dead control.

   Keep the answers traceable to the pages they link. Do not add a personal
   email address or any claim the site does not already make.
   ========================================================================== */
(function () {
  "use strict";

  var root = document.querySelector("[data-site-guide]");
  if (!root) return;

  var launcher = root.querySelector("[data-site-guide-launcher]");
  var panel = root.querySelector("[data-site-guide-panel]");
  var closeButton = root.querySelector("[data-site-guide-close]");
  var log = root.querySelector("[data-site-guide-log]");
  var chips = root.querySelector("[data-site-guide-chips]");
  var form = root.querySelector("[data-site-guide-form]");
  var input = root.querySelector("[data-site-guide-input]");

  if (!launcher || !panel || !closeButton || !log || !chips || !form || !input) {
    return;
  }

  var greeted = false;

  var GREETING = "Hi — I'm a small guide to this site. Ask about Kelvin's background, current work, projects, research, writing, contact, or the clocks and the site itself.";

  var FALLBACK = "I couldn't match that to a page on this site. I can answer questions about Kelvin's background, current work, projects, research, writing, contact, and the clocks. You can also browse <a href=\"about.html\">About</a> or <a href=\"projects.html\">Projects</a>.";

  var FAQ = [
    {
      keys: ["current", "currently", "now", "working", "work", "building", "build",
             "stage", "stages", "stage 6", "stage 7", "status", "progress",
             "complete", "completed", "finished", "review", "pending",
             "dataset", "data set", "proteins", "protein", "residues", "residue",
             "integrity", "checks", "ai", "ai4bio", "ai biotech",
             "machine learning"],
      answer: "Kelvin is building <strong>ai-biotech</strong>, an early-stage AI4Bio project. Stages 1–6 are complete, with the Stage 6 review still pending; Stage 7 (machine learning) has not started. The dataset holds <strong>7 proteins</strong> and <strong>1,098 residues × 29 columns</strong>, with 72/72 integrity checks passing. Details: <a href=\"projects.html\">Projects</a>."
    },
    {
      keys: ["project", "projects", "projects on this site",
             "projects are on this site", "repo", "repos", "repository",
             "repositories", "code", "source code", "built",
             "what has he built", "work sample", "portfolio"],
      answer: "The public work is <strong>ai-biotech</strong> — an early-stage AI4Bio pipeline for protein structure analysis — and <strong>why-biopython-matters</strong>, a technical guide to Biopython. The site states what is unfinished as well as what is finished. See <a href=\"projects.html\">Projects</a> and <a href=\"writing.html\">Writing</a>."
    },
    {
      keys: ["research", "interests", "interest", "directions", "direction",
             "protein structure", "structure prediction", "protein", "structure",
             "plddt", "pae", "ptm", "confidence", "confidence evaluation",
             "alphafold", "reliability", "reliable", "ai4bio", "what is ai4bio",
             "bioinformatics", "computational biology", "biology"],
      answer: "AI for Biotechnology (AI4Bio) is Kelvin's informal umbrella term for using machine learning and deep learning on biological problems. His stated interests include bioinformatics and computational biology, protein structure prediction, and confidence evaluation — including how far measures such as pLDDT and PAE can be trusted. These are directions, not completed research. See <a href=\"research.html\">Research interests</a>."
    },
    {
      keys: ["writing", "write", "wrote", "guide", "biopython", "documentation",
             "documents", "article", "articles", "technical writing",
             "why biopython matters", "seven documents"],
      answer: "The public technical writing is <strong>Why Biopython Matters in Modern Bioinformatics and AI4Bio</strong> — a seven-document guide to what Biopython provides, where its limits lie, and how it fits upstream of modelling. See <a href=\"writing.html\">Technical writing</a>."
    },
    {
      keys: ["contact", "email", "e mail", "reach", "touch", "get in touch",
             "connect", "message", "collaboration", "collaborate", "linkedin",
             "github", "issue", "issues", "mentorship", "mentor", "correction",
             "corrections", "opportunity", "opportunities", "hire"],
      answer: "This site does not publish a personal email address. The public routes are GitHub (preferred — an issue on a repository is fastest) and LinkedIn, both linked from <a href=\"contact.html\">Contact</a>."
    },
    {
      keys: ["about", "background", "bio", "who", "who is", "kelvin", "student",
             "undergraduate", "university", "nwpu", "npu", "education", "degree",
             "program", "programme", "year", "study", "studying", "school", "name",
             "china", "xi an", "xian", "where is xi an", "what is your name",
             "who is kelvin", "phd", "master", "masters"],
      answer: "Kelvin Chandra Djayapranata is an undergraduate student at Northwestern Polytechnical University (NPU/NWPU) in Xi'an, China. He works on the data side of AI for Biotechnology (AI4Bio): protein sequence and structure analysis, residue-level feature extraction, and validated, reproducible datasets from predicted structures. The site does not list his program, year of study, honours, or awards. See <a href=\"about.html\">About</a>."
    },
    {
      keys: ["publication", "publications", "paper", "papers", "award", "awards",
             "honours", "honors", "position", "positions", "research position",
             "validated", "validation", "experimental", "experiment", "results",
             "result", "claims", "claim", "model", "models", "trained", "training",
             "thesis", "achievement", "achievements", "unfinished", "no model",
             "no results", "no publications", "limitation", "limitations", "limits",
             "not claimed", "what is not claimed", "project limitations",
             "dataset limitations"],
      answer: "The site does not claim publications, awards, research positions, or validated biological results. <strong>ai-biotech</strong> is early-stage: no model has been trained, and no wet-lab or experimental validation exists. See <a href=\"projects.html\">Projects</a> for the full list of what is not claimed."
    },
    {
      keys: ["clock", "clocks", "time", "times", "what time", "local time",
             "current time", "time now", "timezone", "time zone", "time difference",
             "wib", "utc", "indonesia", "indonesia time", "china time",
             "time in china", "xi an time", "time in xi an", "time in xian",
             "jam", "waktu"],
      answer: "The two wall clocks show local time in Xi'an, China (UTC+8) and Western Indonesia Time (WIB, UTC+7). They update live in your browser."
    },
    {
      keys: ["site", "website", "this site", "this website", "this guide", "guide",
             "static", "html", "css", "javascript", "js", "framework", "frameworks",
             "built with", "how is this site built", "site work",
             "how does the site work", "about this site", "about the site",
             "hosted", "hosting", "github pages", "chatbot", "chat", "bot",
             "chatgpt", "openai", "llm", "who are you", "what are you",
             "are you ai", "are you real", "do you use ai", "privacy", "tracking",
             "no tracking", "cookie", "cookies", "no cookies", "storage", "account"],
      answer: "This is Kelvin's static portfolio of his public work, built with plain HTML, CSS, and small self-hosted JavaScript files. No frameworks, no build step, no external fonts, no third-party requests, no accounts, no cookies, no storage, and no tracking. This guide is a fixed FAQ that matches answers locally in your browser — no server or API."
    },
    {
      keys: ["cv", "resume", "r sum", "curriculum vitae"],
      answer: "This site does not publish a CV or résumé. The <a href=\"about.html\">About</a> page gives the full public academic summary; <a href=\"contact.html\">Contact</a> lists the GitHub and LinkedIn routes."
    },
    {
      keys: ["thanks", "thank", "thank you", "thx", "terima kasih", "makasih",
             "appreciated"],
      answer: "You're welcome. Ask anything else about this site."
    },
    {
      keys: ["hi", "hello", "hey", "halo", "hai", "selamat", "good morning",
             "good afternoon", "good evening", "help", "what can you do",
             "what can i ask", "how can you help", "what do you do", "start"],
      answer: GREETING
    }
  ];

  function normalize(text) {
    return " " + String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/^\s+|\s+$/g, "") + " ";
  }

  function tokenSet(normalized) {
    var set = {};
    var parts = normalized.split(" ");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i]) set[parts[i]] = true;
    }
    return set;
  }

  function score(entry, normalized, tokens) {
    var total = 0;
    var keys = entry.keys;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key.indexOf(" ") !== -1) {
        if (normalized.indexOf(" " + key + " ") !== -1) total += 2;
      } else if (tokens[key]) {
        total += 1;
      }
    }
    return total;
  }

  function answerFor(text) {
    var normalized = normalize(text);
    var tokens = tokenSet(normalized);
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < FAQ.length; i++) {
      var value = score(FAQ[i], normalized, tokens);
      if (value > bestScore) {
        bestScore = value;
        best = FAQ[i];
      }
    }
    return best ? best.answer : FALLBACK;
  }

  function addMessage(text, who) {
    var message = document.createElement("div");
    message.className = "site-guide__msg site-guide__msg--" + who;
    if (who === "user") {
      message.textContent = text;
    } else {
      message.innerHTML = text;
    }
    log.appendChild(message);
    log.scrollTop = log.scrollHeight;
  }

  function send(text) {
    var value = String(text || "").trim();
    if (!value) return;
    addMessage(value, "user");
    addMessage(answerFor(value), "bot");
  }

  function onKeydown(event) {
    if (event.key === "Escape" || event.keyCode === 27) close();
  }

  function open() {
    if (!panel.hidden) return;
    panel.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    launcher.setAttribute("aria-label", "Close site guide");
    if (!greeted) {
      addMessage(GREETING, "bot");
      greeted = true;
    }
    log.scrollTop = log.scrollHeight;
    input.focus();
    document.addEventListener("keydown", onKeydown);
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", "Open site guide");
    document.removeEventListener("keydown", onKeydown);
    launcher.focus();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var value = input.value.trim();
    if (!value) return;
    send(value);
    input.value = "";
    input.focus();
  });

  chips.addEventListener("click", function (event) {
    var target = event.target;
    while (target && target !== chips) {
      if (target.getAttribute && target.getAttribute("data-site-guide-question")) break;
      target = target.parentNode;
    }
    if (!target || target === chips || !target.getAttribute) return;
    var question = target.getAttribute("data-site-guide-question");
    if (question) send(question);
  });

  launcher.addEventListener("click", function () {
    if (panel.hidden) open();
    else close();
  });

  closeButton.addEventListener("click", close);

  launcher.hidden = false;
})();
