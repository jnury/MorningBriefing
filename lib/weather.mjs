// Open-Meteo provider. Deterministic, keyless, and fetched directly rather than
// via the model — the numbers are facts, not editorial judgement.

const CONDITIONS = [
  [[0], 'Ensoleillé'],
  [[1], 'Plutôt ensoleillé'],
  [[2], 'Partiellement nuageux'],
  [[3], 'Couvert'],
  [[45, 48], 'Brouillard'],
  [[51, 53, 55], 'Bruine'],
  [[56, 57], 'Bruine verglaçante'],
  [[61], 'Pluie faible'],
  [[63], 'Pluie'],
  [[65], 'Pluie forte'],
  [[66, 67], 'Pluie verglaçante'],
  [[71, 73, 75, 77], 'Neige'],
  [[80, 81, 82], 'Averses'],
  [[85, 86], 'Averses de neige'],
  [[95, 96, 99], 'Orage'],
];

export function wmoCondition(code) {
  for (const [codes, label] of CONDITIONS) if (codes.includes(code)) return label;
  return 'Variable';
}

function forecastUrl({ lat, lon }) {
  return 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode'
    + '&timezone=Europe%2FZurich&forecast_days=1';
}

export async function fetchWeatherBucket(bucket, date, { fetchImpl = fetch, now = () => new Date().toISOString() } = {}) {
  const cities = [];
  for (const city of bucket.params.cities) {
    const res = await fetchImpl(forecastUrl(city));
    if (!res.ok) throw new Error(`Open-Meteo ${city.name}: HTTP ${res.status}`);
    const { daily } = await res.json();
    const code = daily.weathercode[0];
    cities.push({
      name: city.name,
      high: Math.round(daily.temperature_2m_max[0]),
      low: Math.round(daily.temperature_2m_min[0]),
      condition: wmoCondition(code),
      weathercode: code,
      precipProbability: Math.round(daily.precipitation_probability_max[0]),
    });
  }
  return { bucketId: bucket.id, date, collectedAt: now(), cities };
}
