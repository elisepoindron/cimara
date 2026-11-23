import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build, parseCsv, seatsOf } from '../../src/seed/comuni/build.ts'

/** ISTAT's header, as it really is: quoted, with line breaks and footnote marks. */
const HEADER = 'Codice Regione;"Codice dell\'Unità territoriale sovracomunale \n(valida a fini statistici)";'
  + 'Codice Comune formato alfanumerico;Denominazione (Italiana e straniera);Denominazione in italiano;'
  + 'Denominazione Regione;Sigla automobilistica'
const row = (region: string, code: string, name: string, regionName: string, sigla: string) =>
  `${region};201;${code};${name};${name};${regionName};${sigla}`

/** GeoNames columns: id, name, ascii, alternates, lat, lon, class, code, cc, cc2, admin1, admin2, admin3. */
const seat = (name: string, lat: number, lon: number, fcode: string, istat: string) =>
  ['1', name, name, '', lat, lon, 'P', fcode, 'IT', '', '12', 'TO', istat].join('\t')

test('a quoted field may hold the separator, a doubled quote and a line break', () => {
  assert.deepEqual(parseCsv('a;"b;c";"say ""hi""\nthere"\r\nd;e;f\n'), [['a', 'b;c', 'say "hi"\nthere'], ['d', 'e', 'f']])
})

test('names and hierarchy come from ISTAT, positions from GeoNames by ISTAT code', () => {
  const csv = [HEADER,
    row('01', '001270', 'Susa', 'Piemonte', 'TO'),
    row('01', '001272', 'Torino', 'Piemonte', 'TO'),
    row('04', '022165', 'Samone', 'Trentino-Alto Adige/Südtirol', 'TN'),
  ].join('\n')
  const geonames = [
    seat('Susa', 45.13677, 7.05809, 'PPLA3', '001270'),
    seat('Turin', 45.07049, 7.68682, 'PPLA', '001272'),
  ].join('\n')

  const built = build(csv, geonames)
  const byName = (n: string) => built.places.find(p => p.name === n)
  assert.deepEqual(byName('Torino'), { key: 'comune-001272', name: 'Torino', kind: 'comune', parent: 'provincia-TO',
    lat: 45.07049, lon: 7.68682 }, 'the Italian name, never GeoNames’ Turin')
  assert.equal(byName('Trentino-Alto Adige')?.kind, 'regione', 'the Italian half of a bilingual name')
  assert.equal(byName('TO')?.parent, 'regione-01')
  assert.equal(byName('Samone')?.lat, undefined, 'no seat: kept, without a position invented for it')
  assert.deepEqual(built.unplaced, ['Samone'])
})

test('of two seats for one comune, the higher-ranked is kept', () => {
  const seats = seatsOf([seat('Frazione', 1, 1, 'PPLA3', '001272'), seat('Turin', 2, 2, 'PPLA', '001272')].join('\n'))
  assert.deepEqual(seats.get('001272'), { lat: 2, lon: 2 })
})

test('a row that cannot be read is refused by name, never patched', () => {
  assert.throws(() => build([HEADER, row('01', '1270', 'Susa', 'Piemonte', 'TO')].join('\n'), ''), /cannot read row/)
})
