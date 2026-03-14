mapboxgl.accessToken = "pk.eyJ1IjoibmluYW5vdW4iLCJhIjoiY2pjdHBoZGlzMnV4dDJxcGc5azJkbWRiYSJ9.o4dZRrdHcgVEKCveOXG1YQ";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/light-v11",
  center: [2.4, 46.4],
  zoom: 5.5,
  attributionControl: true,
  customAttribution: "Cartographie : Mouhamadou Lamine GUEYE · Données DVF"
});
map.addControl(
  new mapboxgl.ScaleControl({ maxWidth: 120, unit: "metric" }),
  "bottom-left"
);

map.addControl(
  new mapboxgl.NavigationControl({
    showZoom: false,
    showCompass: true,
    visualizePitch: false
  }),
  "top-right"
);

const yearSelect = document.getElementById("yearSelect");
const typeSelect = document.getElementById("typeSelect");
const varSelect = document.getElementById("varSelect");

const mainTitle = document.getElementById("mainTitle");
const subTitle = document.getElementById("subTitle");
const legendTitle = document.getElementById("legendTitle");
const legendItems = document.getElementById("legendItems");
const legendNote = document.getElementById("legendNote");
const histTitle = document.getElementById("histTitle");
const statusText = document.getElementById("statusText");

let currentGeojson = null;
let histogramChart = null;
let mapReady = false;
let hoverPopup = null;
let hoveredFeatureId = null;

const yearCache = new Map();

const AVAILABLE_YEARS = [
  2014, 2015, 2016, 2017, 2018, 2019,
  2020, 2021, 2022, 2023, 2024
];

const CLASS_CONFIG = {
  prix_m2_moy: {
    title: "Prix moyen au m² par commune",
    note: "Agrégation statistique à l’échelle communale.",
    classes: [
      { min: -Infinity, max: 1000, color: "#20a63a", label: "Moins de 1000 € / m²" },
      { min: 1000, max: 1300, color: "#76c95c", label: "1000 – 1300 € / m²" },
      { min: 1300, max: 1600, color: "#cfe98a", label: "1300 – 1600 € / m²" },
      { min: 1600, max: 1900, color: "#f4efb2", label: "1600 – 1900 € / m²" },
      { min: 1900, max: 2200, color: "#f6c66f", label: "1900 – 2200 € / m²" },
      { min: 2200, max: 3000, color: "#ef8a4c", label: "2200 – 3000 € / m²" },
      { min: 3000, max: Infinity, color: "#e31a1c", label: "Plus de 3000 € / m²" }
    ]
  },

  prix_m2_med: {
    title: "Prix médian au m² par commune",
    note: "Agrégation statistique à l’échelle communale.",
    classes: [
      { min: -Infinity, max: 1000, color: "#20a63a", label: "Moins de 1000 € / m²" },
      { min: 1000, max: 1300, color: "#76c95c", label: "1000 – 1300 € / m²" },
      { min: 1300, max: 1600, color: "#cfe98a", label: "1300 – 1600 € / m²" },
      { min: 1600, max: 1900, color: "#f4efb2", label: "1600 – 1900 € / m²" },
      { min: 1900, max: 2200, color: "#f6c66f", label: "1900 – 2200 € / m²" },
      { min: 2200, max: 3000, color: "#ef8a4c", label: "2200 – 3000 € / m²" },
      { min: 3000, max: Infinity, color: "#e31a1c", label: "Plus de 3000 € / m²" }
    ]
  },

  valeur_med: {
    title: "Valeur médiane par commune",
    note: "Médiane des valeurs foncières à l’échelle communale.",
    classes: [
      { min: -Infinity, max: 80000, color: "#20a63a", label: "Moins de 80 000 €" },
      { min: 80000, max: 120000, color: "#76c95c", label: "80 000 – 120 000 €" },
      { min: 120000, max: 160000, color: "#cfe98a", label: "120 000 – 160 000 €" },
      { min: 160000, max: 220000, color: "#f4efb2", label: "160 000 – 220 000 €" },
      { min: 220000, max: 300000, color: "#f6c66f", label: "220 000 – 300 000 €" },
      { min: 300000, max: 450000, color: "#ef8a4c", label: "300 000 – 450 000 €" },
      { min: 450000, max: Infinity, color: "#e31a1c", label: "Plus de 450 000 €" }
    ]
  }
};

function buildYearFilePath(year) {
  return `./data/DVF_${year}_light.geojson`;
}

function safeNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatEuro(v) {
  const n = safeNumber(v);
  if (n === null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0
  }).format(n);
}

function formatNumber(v) {
  const n = safeNumber(v);
  if (n === null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0
  }).format(n);
}

function getFeatureName(props) {
  return props.nom_commune || props.commune_norm || "Commune inconnue";
}

function getCurrentConfig() {
  return CLASS_CONFIG[varSelect.value] || CLASS_CONFIG.prix_m2_moy;
}

function updateLegend() {
  const config = getCurrentConfig();
  legendTitle.textContent = config.title;
  legendNote.textContent = config.note;

  legendItems.innerHTML = config.classes
    .slice()
    .reverse()
    .map(cls => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${cls.color};"></span>
        <span class="legend-label">${cls.label}</span>
      </div>
    `)
    .join("");
}

function getTypeLabel(typeValue) {
  if (!typeValue || typeValue === "Tous") return "Ventes de tous les biens";
  if (typeValue === "Maison") return "Ventes des maisons";
  if (typeValue === "Appartement") return "Ventes des appartements";
  return `Ventes de ${typeValue}`;
}

function getVariableTitle(variable) {
  const labels = {
    prix_m2_moy: "Prix de l’immobilier",
    prix_m2_med: "Prix médian de l’immobilier",
    valeur_med: "Valeur médiane des transactions"
  };
  return labels[variable] || "Analyse immobilière";
}

function updateTitles() {
  mainTitle.textContent = `#${getVariableTitle(varSelect.value)} en ${yearSelect.value}`;
  subTitle.textContent = getTypeLabel(typeSelect.value);
  histTitle.textContent = `Distribution — ${getCurrentConfig().title}`;
}

function initYearFilter() {
  yearSelect.innerHTML = AVAILABLE_YEARS
    .map(y => `<option value="${y}">${y}</option>`)
    .join("");
  yearSelect.value = "2024";
}

function initTypeFilter(features) {
  const current = typeSelect.value || "Tous";

  const types = [...new Set(
    features.map(f => f.properties?.type_local).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, "fr"));

  typeSelect.innerHTML = `
    <option value="Tous">Tous les biens</option>
    ${types.map(t => `<option value="${t}">${t}</option>`).join("")}
  `;

  typeSelect.value = types.includes(current) ? current : "Tous";
}

function filterFeatures() {
  if (!currentGeojson) return [];

  const selectedType = typeSelect.value;

  return currentGeojson.features.filter(feature => {
    const p = feature.properties || {};
    return feature.geometry && (selectedType === "Tous" || p.type_local === selectedType);
  });
}

function buildColorExpression(variable) {
  const classes = CLASS_CONFIG[variable].classes;
  const expression = ["case"];

  expression.push(["==", ["coalesce", ["get", variable], null], null]);
  expression.push("#d9d9d9");

  for (const cls of classes) {
    if (cls.min === -Infinity) {
      expression.push(["<", ["to-number", ["get", variable]], cls.max]);
      expression.push(cls.color);
    } else if (cls.max === Infinity) {
      expression.push([">=", ["to-number", ["get", variable]], cls.min]);
      expression.push(cls.color);
    } else {
      expression.push([
        "all",
        [">=", ["to-number", ["get", variable]], cls.min],
        ["<", ["to-number", ["get", variable]], cls.max]
      ]);
      expression.push(cls.color);
    }
  }

  expression.push("#d9d9d9");
  return expression;
}

function makeLightFeature(feature) {
  const p = feature.properties || {};

  return {
    type: "Feature",
    geometry: feature.geometry,
    properties: {
      ANNEE: p.ANNEE ?? null,
      type_local: p.type_local ?? null,
      nom_commune: p.nom_commune ?? null,
      code_departement: p.code_departement ?? null,
      code_geo: p.code_geo ?? null,
      prix_m2_moy: safeNumber(p.prix_m2_moy),
      prix_m2_med: safeNumber(p.prix_m2_med),
      valeur_med: safeNumber(p.valeur_med),
      nb_ventes: safeNumber(p.nb_ventes)
    }
  };
}

function updateMap(features) {
  if (!mapReady || !map.getSource("dvf")) return;

  if (hoverPopup) {
    hoverPopup.remove();
    hoveredFeatureId = null;
  }

  const lightFeatures = features.map(makeLightFeature);

  map.getSource("dvf").setData({
    type: "FeatureCollection",
    features: lightFeatures
  });

  map.setPaintProperty("dvf-fill", "fill-color", buildColorExpression(varSelect.value));
}

function buildHistogramCounts(values, config) {
  const counts = config.classes.map(() => 0);

  for (const v of values) {
    const n = safeNumber(v);
    if (n === null) continue;

    for (let i = 0; i < config.classes.length; i++) {
      const cls = config.classes[i];
      if (n >= cls.min && n < cls.max) {
        counts[i]++;
        break;
      }
    }
  }

  return counts;
}

function updateHistogram(features) {
  const canvas = document.getElementById("histogramChart");
  if (!canvas) return;

  const config = getCurrentConfig();
  const values = features
    .map(f => safeNumber(f.properties?.[varSelect.value]))
    .filter(v => v !== null);

  const counts = buildHistogramCounts(values, config);
  const labels = config.classes.map(c => c.label);
  const colors = config.classes.map(c => c.color);

  if (histogramChart) histogramChart.destroy();

  histogramChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: colors,
        borderColor: "rgba(0,0,0,0.12)",
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              return `${formatNumber(context.raw)} entités`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#666",
            maxRotation: 45,
            minRotation: 45,
            font: { size: 10 }
          },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#666" },
          grid: { color: "rgba(0,0,0,0.08)" }
        }
      }
    }
  });
}

function popupHTML(props) {
  return `
    <div class="tooltip-title">${getFeatureName(props)}</div>
    <div class="tooltip-sub">Département ${props.code_departement ?? "—"} · ${props.type_local ?? "—"}</div>

    <div class="tooltip-line"><span>Année</span><strong>${props.ANNEE ?? "—"}</strong></div>
    <div class="tooltip-line"><span>Prix moyen au m²</span><strong>${formatEuro(props.prix_m2_moy)}</strong></div>
    <div class="tooltip-line"><span>Prix médian au m²</span><strong>${formatEuro(props.prix_m2_med)}</strong></div>
    <div class="tooltip-line"><span>Valeur médiane</span><strong>${formatEuro(props.valeur_med)}</strong></div>
    <div class="tooltip-line"><span>Nombre de ventes</span><strong>${formatNumber(props.nb_ventes)}</strong></div>
    <div class="tooltip-line"><span>Code commune</span><strong>${props.code_geo ?? "—"}</strong></div>
  `;
}

function initMapLayers() {
  hoverPopup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    closeOnMove: false,
    offset: 12,
    maxWidth: "320px"
  });

  map.addSource("dvf", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: []
    },
    tolerance: 1,
    generateId: false
  });

  map.addLayer({
    id: "dvf-fill",
    type: "fill",
    source: "dvf",
    paint: {
      "fill-color": buildColorExpression(varSelect.value),
      "fill-opacity": 0.90
    }
  });

  map.on("mousemove", "dvf-fill", e => {
    const feature = e.features?.[0];
    if (!feature) return;

    const props = feature.properties || {};
    const featureId =
      props.code_geo ||
      props.nom_commune ||
      JSON.stringify([props.code_departement, props.type_local, props.ANNEE]);

    map.getCanvas().style.cursor = "pointer";
    hoverPopup.setLngLat(e.lngLat);

    if (hoveredFeatureId !== featureId) {
      hoveredFeatureId = featureId;
      hoverPopup.setHTML(popupHTML(props));
    }

    if (!hoverPopup.isOpen()) {
      hoverPopup.addTo(map);
    }
  });

  map.on("mouseleave", "dvf-fill", () => {
    map.getCanvas().style.cursor = "";
    hoveredFeatureId = null;
    if (hoverPopup) hoverPopup.remove();
  });

  mapReady = true;
}

function updateDashboard() {
  if (!currentGeojson) return;

  const features = filterFeatures();
  updateTitles();
  updateLegend();
  updateMap(features);
  updateHistogram(features);

  statusText.textContent = `${features.length.toLocaleString("fr-FR")} entités affichées.`;
}

async function loadYearData(year) {
  try {
    statusText.textContent = `Chargement de ${year}…`;

    if (yearCache.has(String(year))) {
      currentGeojson = yearCache.get(String(year));
    } else {
      const response = await fetch(buildYearFilePath(year));
      if (!response.ok) {
        throw new Error(`Fichier introuvable : ${buildYearFilePath(year)}`);
      }

      const geojson = await response.json();

      if (!geojson.features || !Array.isArray(geojson.features)) {
        throw new Error("GeoJSON invalide");
      }

      currentGeojson = geojson;
      yearCache.set(String(year), geojson);
    }

    initTypeFilter(currentGeojson.features);
    updateDashboard();

    statusText.textContent = `${filterFeatures().length.toLocaleString("fr-FR")} entités affichées pour ${year}.`;
  } catch (error) {
    console.error(error);
    statusText.textContent = `Erreur : ${error.message}`;
    alert(error.message);
  }
}

yearSelect.addEventListener("change", () => {
  loadYearData(yearSelect.value);
});

typeSelect.addEventListener("change", updateDashboard);
varSelect.addEventListener("change", updateDashboard);

initYearFilter();
updateTitles();
updateLegend();

if (map.loaded()) {
  initMapLayers();
  loadYearData(yearSelect.value);
} else {
  map.once("load", () => {
    initMapLayers();
    loadYearData(yearSelect.value);
  });
}
