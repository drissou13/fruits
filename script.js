/*
  photos.js : trouve automatiquement la photo de chaque fruit, directement dans le navigateur.
  Aucun serveur, aucun téléchargement : parfait pour GitHub Pages.

  Comment ça marche :
  - pour chaque carte affichée, il cherche une photo libre sur Wikimedia Commons ;
  - il ne cherche que les photos visibles à l'écran (rapide, poli avec le serveur) ;
  - il garde les résultats dans le navigateur (localStorage) : la 2e visite est instantanée ;
  - l'auteur et la licence s'affichent au survol de la photo et dans la fiche du fruit ;
  - si rien n'est trouvé, l'emoji du fruit reste affiché.
*/
(() => {
  // Mets true si tu as aussi mis tes propres photos dans le dossier images/ (essayées en premier).
  const UTILISER_IMAGES_LOCALES = false;

  const CLE = "fruits-photos-v1";
  const SEPT_JOURS = 7 * 24 * 3600 * 1000;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(CLE) || "{}"); } catch (e) {}
  const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify(cache)); } catch (e) {} };

  const pause = ms => new Promise(r => setTimeout(r, ms));
  const nettoie = t => (t || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

  /* ---------- Recherche sur Wikimedia Commons ---------- */
  async function chercherCommons(requete) {
    const params = new URLSearchParams({
      action: "query", format: "json", origin: "*", generator: "search",
      gsrnamespace: "6", gsrlimit: "12", gsrsearch: requete + " filetype:bitmap",
      prop: "imageinfo", iiprop: "url|mime|extmetadata", iiurlwidth: "500"
    });
    const rep = await fetch("https://commons.wikimedia.org/w/api.php?" + params);
    if (!rep.ok) throw new Error("HTTP " + rep.status);
    const data = await rep.json();
    const pages = Object.values((data.query && data.query.pages) || {}).sort((a, b) => a.index - b.index);
    for (const p of pages) {
      const i = p.imageinfo && p.imageinfo[0];
      if (i && i.mime === "image/jpeg" && i.thumburl) {
        const m = i.extmetadata || {};
        return {
          url: i.thumburl,
          auteur: nettoie(m.Artist && m.Artist.value) || "Auteur inconnu",
          licence: nettoie(m.LicenseShortName && m.LicenseShortName.value),
          page: i.descriptionurl
        };
      }
    }
    return null;
  }

  async function trouverPhoto(fruit, nom) {
    for (const q of [`${fruit} ${nom} fruit`, `${nom} ${fruit}`, `${nom} fruit`]) {
      const r = await chercherCommons(q);
      if (r) return r;
      await pause(200);
    }
    return null; // vraiment rien trouvé
  }

  /* ---------- File d'attente : 2 requêtes à la fois maximum ---------- */
  let actifs = 0;
  const attente = [];
  const enCours = new Map();
  function pomper() {
    while (actifs < 2 && attente.length) {
      const tache = attente.shift();
      actifs++;
      tache().finally(() => { actifs--; setTimeout(pomper, 150); });
    }
  }
  function infoPour(id, fruit, nom) {
    if (!enCours.has(id)) {
      enCours.set(id, new Promise(resolve => {
        attente.push(async () => {
          try {
            const info = await trouverPhoto(fruit, nom);
            cache[id] = info || { introuvable: Date.now() };
            sauver();
            resolve(info);
          } catch (e) { resolve(undefined); } // erreur réseau : on ne retient rien
          finally { enCours.delete(id); }
        });
        pomper();
      }));
    }
    return enCours.get(id);
  }

  /* ---------- Affichage ---------- */
  function ajouterCredit(img, info) {
    img.title = `Photo : ${info.auteur}${info.licence ? " (" + info.licence + ")" : ""} - Wikimedia Commons`;
    const panneau = img.closest(".panel");
    if (!panneau || panneau.querySelector(".credit")) return;
    const p = document.createElement("p");
    p.className = "astuce credit";
    p.append("📷 " + info.auteur + (info.licence ? " · " + info.licence : "") + " · ");
    const a = document.createElement("a");
    a.href = info.page; a.target = "_blank"; a.rel = "noopener"; a.textContent = "source";
    p.append(a);
    panneau.lastElementChild.append(p);
  }

  function montrer(img, info) {
    img.onerror = () => img.remove();
    img.src = info.url;
    ajouterCredit(img, info);
  }

  async function chercherEtMontrer(img) {
    const { id, fruit, nom } = img.dataset;
    const connu = cache[id];
    if (connu && connu.url) return montrer(img, connu);
    if (connu && connu.introuvable && Date.now() - connu.introuvable < SEPT_JOURS) return img.remove();
    const info = await infoPour(id, fruit, nom);
    if (info) montrer(img, info);
    else if (info === null) img.remove();
  }

  function traiter(img) {
    if (img.dataset.traite) return;
    img.dataset.traite = "1";
    if (UTILISER_IMAGES_LOCALES && img.dataset.local) {
      img.onerror = () => chercherEtMontrer(img);
      img.src = img.dataset.local;
    } else {
      chercherEtMontrer(img);
    }
  }

  /* ---------- Observer : seulement les photos visibles ---------- */
  const vue = new IntersectionObserver(entrees => {
    entrees.forEach(e => { if (e.isIntersecting) { vue.unobserve(e.target); traiter(e.target); } });
  }, { rootMargin: "200px" });

  function scanner(racine) {
    (racine.querySelectorAll ? racine.querySelectorAll("img[data-fruit]") : [])
      .forEach(img => { if (!img.dataset.traite) vue.observe(img); });
  }

  // La grille et la fiche sont recréées à chaque filtre/clic : on surveille les changements.
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
    if (n.nodeType === 1) { if (n.matches && n.matches("img[data-fruit]")) vue.observe(n); else scanner(n); }
  }))).observe(document.body, { childList: true, subtree: true });

  scanner(document);
})();
