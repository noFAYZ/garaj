/**
 * Vehicle manufacturers, and the domain each one's logo is fetched by.
 *
 * Logos come from logo.dev, which is addressed by domain — so this is a name-to-domain map,
 * not a pile of bundled SVGs. That is why it can be this long and still cost a few kilobytes:
 * the previous approach inlined 39 logos for 42 kB gzipped, and covered a fraction of what
 * is here.
 *
 * `kinds` is what the picker filters by. A make that builds both — Honda, Suzuki, BMW — is
 * listed under both, because a motorcycle owner searching "Honda" should find it.
 */

export type MakeKind = 'car' | 'moto' | 'truck' | 'other';

export interface VehicleMake {
  readonly name: string;
  /** The manufacturer's own domain — what logo.dev keys on. */
  readonly domain: string;
  readonly kinds: readonly MakeKind[];
}

const CAR = ['car'] as const;
const MOTO = ['moto'] as const;
const BOTH = ['car', 'moto'] as const;
const TRUCK = ['truck'] as const;

export const VEHICLE_MAKES: readonly VehicleMake[] = [
  // Japan
  { name: 'Toyota', domain: 'toyota.com', kinds: CAR },
  { name: 'Honda', domain: 'honda.com', kinds: BOTH },
  { name: 'Nissan', domain: 'nissan-global.com', kinds: CAR },
  { name: 'Mazda', domain: 'mazda.com', kinds: CAR },
  { name: 'Subaru', domain: 'subaru.com', kinds: CAR },
  { name: 'Mitsubishi', domain: 'mitsubishi-motors.com', kinds: CAR },
  { name: 'Suzuki', domain: 'globalsuzuki.com', kinds: BOTH },
  { name: 'Lexus', domain: 'lexus.com', kinds: CAR },
  { name: 'Infiniti', domain: 'infiniti.com', kinds: CAR },
  { name: 'Acura', domain: 'acura.com', kinds: CAR },
  { name: 'Daihatsu', domain: 'daihatsu.com', kinds: CAR },
  { name: 'Isuzu', domain: 'isuzu.co.jp', kinds: ['car', 'truck'] },
  { name: 'Hino', domain: 'hino-global.com', kinds: TRUCK },
  { name: 'Yamaha', domain: 'yamaha-motor.com', kinds: MOTO },
  { name: 'Kawasaki', domain: 'kawasaki.com', kinds: MOTO },

  // Korea
  { name: 'Hyundai', domain: 'hyundai.com', kinds: CAR },
  { name: 'Kia', domain: 'kia.com', kinds: CAR },
  { name: 'Genesis', domain: 'genesis.com', kinds: CAR },
  { name: 'SsangYong', domain: 'kg-mobility.com', kinds: CAR },
  { name: 'Daewoo', domain: 'gm.com', kinds: CAR },

  // Germany
  { name: 'Volkswagen', domain: 'vw.com', kinds: CAR },
  { name: 'BMW', domain: 'bmw.com', kinds: BOTH },
  { name: 'Mercedes-Benz', domain: 'mercedes-benz.com', kinds: ['car', 'truck'] },
  { name: 'Audi', domain: 'audi.com', kinds: CAR },
  { name: 'Porsche', domain: 'porsche.com', kinds: CAR },
  { name: 'Opel', domain: 'opel.com', kinds: CAR },
  { name: 'Smart', domain: 'smart.com', kinds: CAR },
  { name: 'Maybach', domain: 'mercedes-benz.com', kinds: CAR },
  { name: 'MAN', domain: 'man.eu', kinds: TRUCK },
  { name: 'Setra', domain: 'setra.de', kinds: TRUCK },
  { name: 'Borgward', domain: 'borgward.com', kinds: CAR },
  { name: 'Wiesmann', domain: 'wiesmann.com', kinds: CAR },
  { name: 'Alpina', domain: 'alpina-automobiles.com', kinds: CAR },
  { name: 'Ruf', domain: 'ruf-automobile.de', kinds: CAR },
  { name: 'Brabus', domain: 'brabus.com', kinds: CAR },

  // France
  { name: 'Peugeot', domain: 'peugeot.com', kinds: CAR },
  { name: 'Renault', domain: 'renault.com', kinds: CAR },
  { name: 'Citroën', domain: 'citroen.com', kinds: CAR },
  { name: 'DS Automobiles', domain: 'dsautomobiles.com', kinds: CAR },
  { name: 'Alpine', domain: 'alpinecars.com', kinds: CAR },
  { name: 'Bugatti', domain: 'bugatti.com', kinds: CAR },
  { name: 'Venturi', domain: 'venturi.com', kinds: CAR },
  { name: 'Ligier', domain: 'ligier.fr', kinds: CAR },

  // Italy
  { name: 'Fiat', domain: 'fiat.com', kinds: CAR },
  { name: 'Ferrari', domain: 'ferrari.com', kinds: CAR },
  { name: 'Lamborghini', domain: 'lamborghini.com', kinds: CAR },
  { name: 'Maserati', domain: 'maserati.com', kinds: CAR },
  { name: 'Alfa Romeo', domain: 'alfaromeo.com', kinds: CAR },
  { name: 'Lancia', domain: 'lancia.com', kinds: CAR },
  { name: 'Abarth', domain: 'abarth.com', kinds: CAR },
  { name: 'Pagani', domain: 'pagani.com', kinds: CAR },
  { name: 'De Tomaso', domain: 'detomaso.com', kinds: CAR },
  { name: 'Iveco', domain: 'iveco.com', kinds: TRUCK },
  { name: 'Ducati', domain: 'ducati.com', kinds: MOTO },
  { name: 'Aprilia', domain: 'aprilia.com', kinds: MOTO },
  { name: 'Moto Guzzi', domain: 'motoguzzi.com', kinds: MOTO },
  { name: 'MV Agusta', domain: 'mvagusta.com', kinds: MOTO },
  { name: 'Vespa', domain: 'vespa.com', kinds: MOTO },
  { name: 'Piaggio', domain: 'piaggio.com', kinds: MOTO },
  { name: 'Benelli', domain: 'benelli.com', kinds: MOTO },
  { name: 'Beta', domain: 'betamotor.com', kinds: MOTO },
  { name: 'Fantic', domain: 'fanticmotor.it', kinds: MOTO },

  // United Kingdom
  { name: 'Land Rover', domain: 'landrover.com', kinds: CAR },
  { name: 'Jaguar', domain: 'jaguar.com', kinds: CAR },
  { name: 'Mini', domain: 'mini.com', kinds: CAR },
  { name: 'Bentley', domain: 'bentleymotors.com', kinds: CAR },
  { name: 'Rolls-Royce', domain: 'rolls-roycemotorcars.com', kinds: CAR },
  { name: 'Aston Martin', domain: 'astonmartin.com', kinds: CAR },
  { name: 'McLaren', domain: 'mclaren.com', kinds: CAR },
  { name: 'Lotus', domain: 'lotuscars.com', kinds: CAR },
  { name: 'Morgan', domain: 'morgan-motor.com', kinds: CAR },
  { name: 'Caterham', domain: 'caterhamcars.com', kinds: CAR },
  { name: 'TVR', domain: 'tvr.co.uk', kinds: CAR },
  { name: 'Vauxhall', domain: 'vauxhall.co.uk', kinds: CAR },
  { name: 'Rover', domain: 'rover.com', kinds: CAR },
  { name: 'MG', domain: 'mg.co.uk', kinds: CAR },
  { name: 'Triumph', domain: 'triumphmotorcycles.com', kinds: MOTO },
  { name: 'Norton', domain: 'nortonmotorcycles.com', kinds: MOTO },
  { name: 'BSA', domain: 'bsacompany.co.uk', kinds: MOTO },
  { name: 'Royal Enfield', domain: 'royalenfield.com', kinds: MOTO },

  // Sweden, Czechia, Spain, Romania, Netherlands
  { name: 'Volvo', domain: 'volvocars.com', kinds: ['car', 'truck'] },
  { name: 'Polestar', domain: 'polestar.com', kinds: CAR },
  { name: 'Saab', domain: 'saab.com', kinds: CAR },
  { name: 'Koenigsegg', domain: 'koenigsegg.com', kinds: CAR },
  { name: 'Scania', domain: 'scania.com', kinds: TRUCK },
  { name: 'Škoda', domain: 'skoda-auto.com', kinds: CAR },
  { name: 'Tatra', domain: 'tatra.cz', kinds: TRUCK },
  { name: 'Jawa', domain: 'jawa.eu', kinds: MOTO },
  { name: 'SEAT', domain: 'seat.com', kinds: CAR },
  { name: 'Cupra', domain: 'cupraofficial.com', kinds: CAR },
  { name: 'Dacia', domain: 'dacia.com', kinds: CAR },
  { name: 'DAF', domain: 'daf.com', kinds: TRUCK },
  { name: 'Spyker', domain: 'spykercars.com', kinds: CAR },
  { name: 'Donkervoort', domain: 'donkervoort.com', kinds: CAR },

  // United States
  { name: 'Ford', domain: 'ford.com', kinds: ['car', 'truck'] },
  { name: 'Chevrolet', domain: 'chevrolet.com', kinds: CAR },
  { name: 'GMC', domain: 'gmc.com', kinds: ['car', 'truck'] },
  { name: 'Dodge', domain: 'dodge.com', kinds: CAR },
  { name: 'Ram', domain: 'ramtrucks.com', kinds: TRUCK },
  { name: 'Chrysler', domain: 'chrysler.com', kinds: CAR },
  { name: 'Jeep', domain: 'jeep.com', kinds: CAR },
  { name: 'Cadillac', domain: 'cadillac.com', kinds: CAR },
  { name: 'Buick', domain: 'buick.com', kinds: CAR },
  { name: 'Lincoln', domain: 'lincoln.com', kinds: CAR },
  { name: 'Tesla', domain: 'tesla.com', kinds: CAR },
  { name: 'Rivian', domain: 'rivian.com', kinds: ['car', 'truck'] },
  { name: 'Lucid', domain: 'lucid.com', kinds: CAR },
  { name: 'Hummer', domain: 'gmc.com', kinds: CAR },
  { name: 'Pontiac', domain: 'gm.com', kinds: CAR },
  { name: 'Saturn', domain: 'gm.com', kinds: CAR },
  { name: 'Oldsmobile', domain: 'gm.com', kinds: CAR },
  { name: 'Plymouth', domain: 'chrysler.com', kinds: CAR },
  { name: 'Mercury', domain: 'ford.com', kinds: CAR },
  { name: 'Freightliner', domain: 'freightliner.com', kinds: TRUCK },
  { name: 'Peterbilt', domain: 'peterbilt.com', kinds: TRUCK },
  { name: 'Kenworth', domain: 'kenworth.com', kinds: TRUCK },
  { name: 'Mack', domain: 'macktrucks.com', kinds: TRUCK },
  { name: 'International', domain: 'international.com', kinds: TRUCK },
  { name: 'Harley-Davidson', domain: 'harley-davidson.com', kinds: MOTO },
  { name: 'Indian Motorcycle', domain: 'indianmotorcycle.com', kinds: MOTO },
  { name: 'Polaris', domain: 'polaris.com', kinds: ['moto', 'other'] },
  { name: 'Can-Am', domain: 'can-am.brp.com', kinds: ['moto', 'other'] },
  { name: 'Zero Motorcycles', domain: 'zeromotorcycles.com', kinds: MOTO },
  { name: 'Buell', domain: 'buellmotorcycle.com', kinds: MOTO },

  // China
  { name: 'BYD', domain: 'byd.com', kinds: CAR },
  { name: 'Geely', domain: 'geely.com', kinds: CAR },
  { name: 'Chery', domain: 'cheryinternational.com', kinds: CAR },
  { name: 'Great Wall', domain: 'gwm-global.com', kinds: CAR },
  { name: 'Haval', domain: 'haval-global.com', kinds: CAR },
  { name: 'NIO', domain: 'nio.com', kinds: CAR },
  { name: 'XPeng', domain: 'xpeng.com', kinds: CAR },
  { name: 'Li Auto', domain: 'lixiang.com', kinds: CAR },
  { name: 'Zeekr', domain: 'zeekrglobal.com', kinds: CAR },
  { name: 'Wuling', domain: 'wuling.com', kinds: CAR },
  { name: 'Changan', domain: 'globalchangan.com', kinds: CAR },
  { name: 'Dongfeng', domain: 'dfmc.com.cn', kinds: CAR },
  { name: 'FAW', domain: 'faw.com.cn', kinds: CAR },
  { name: 'SAIC', domain: 'saicmotor.com', kinds: CAR },
  { name: 'Hongqi', domain: 'hongqi-auto.com', kinds: CAR },
  { name: 'Omoda', domain: 'omoda.com', kinds: CAR },
  { name: 'Jaecoo', domain: 'jaecoo.com', kinds: CAR },
  { name: 'Foton', domain: 'foton-global.com', kinds: TRUCK },
  { name: 'Sinotruk', domain: 'sinotruk.com', kinds: TRUCK },

  // India
  { name: 'Tata', domain: 'tatamotors.com', kinds: ['car', 'truck'] },
  { name: 'Mahindra', domain: 'mahindra.com', kinds: ['car', 'truck'] },
  { name: 'Maruti Suzuki', domain: 'marutisuzuki.com', kinds: CAR },
  { name: 'Ashok Leyland', domain: 'ashokleyland.com', kinds: TRUCK },
  { name: 'Force Motors', domain: 'forcemotors.com', kinds: CAR },
  { name: 'Hero MotoCorp', domain: 'heromotocorp.com', kinds: MOTO },
  { name: 'Bajaj', domain: 'bajajauto.com', kinds: MOTO },
  { name: 'TVS', domain: 'tvsmotor.com', kinds: MOTO },
  { name: 'Ola Electric', domain: 'olaelectric.com', kinds: MOTO },
  { name: 'Ather', domain: 'atherenergy.com', kinds: MOTO },

  // Rest of the world
  { name: 'Proton', domain: 'proton.com', kinds: CAR },
  { name: 'Perodua', domain: 'perodua.com.my', kinds: CAR },
  { name: 'VinFast', domain: 'vinfastauto.com', kinds: CAR },
  { name: 'Lada', domain: 'lada.ru', kinds: CAR },
  { name: 'UAZ', domain: 'uaz.ru', kinds: CAR },
  { name: 'GAZ', domain: 'gazgroup.ru', kinds: TRUCK },
  { name: 'KamAZ', domain: 'kamaz.ru', kinds: TRUCK },
  { name: 'Togg', domain: 'togg.com.tr', kinds: CAR },
  { name: 'Holden', domain: 'gm.com', kinds: CAR },
  { name: 'KTM', domain: 'ktm.com', kinds: MOTO },
  { name: 'Husqvarna', domain: 'husqvarna-motorcycles.com', kinds: MOTO },
  { name: 'GasGas', domain: 'gasgas.com', kinds: MOTO },
  { name: 'SYM', domain: 'sym-global.com', kinds: MOTO },
  { name: 'Kymco', domain: 'kymco.com', kinds: MOTO },
  { name: 'CFMoto', domain: 'cfmoto.com', kinds: MOTO },
  { name: 'Sherco', domain: 'sherco.com', kinds: MOTO },
  { name: 'Rieju', domain: 'rieju.es', kinds: MOTO },
  { name: 'Segway', domain: 'segway.com', kinds: ['moto', 'other'] },
  { name: 'Niu', domain: 'niu.com', kinds: MOTO },
  { name: 'Super Soco', domain: 'supersoco.com', kinds: MOTO },

  // Bicycles
  { name: 'Trek', domain: 'trekbikes.com', kinds: ['other'] },
  { name: 'Specialized', domain: 'specialized.com', kinds: ['other'] },
  { name: 'Giant', domain: 'giant-bicycles.com', kinds: ['other'] },
  { name: 'Cannondale', domain: 'cannondale.com', kinds: ['other'] },
  { name: 'Scott', domain: 'scott-sports.com', kinds: ['other'] },
  { name: 'Canyon', domain: 'canyon.com', kinds: ['other'] },
  { name: 'Bianchi', domain: 'bianchi.com', kinds: ['other'] },
  { name: 'Cube', domain: 'cube.eu', kinds: ['other'] },
  { name: 'Merida', domain: 'merida-bikes.com', kinds: ['other'] },
  { name: 'Santa Cruz', domain: 'santacruzbicycles.com', kinds: ['other'] },
  { name: 'Brompton', domain: 'brompton.com', kinds: ['other'] },
  { name: 'VanMoof', domain: 'vanmoof.com', kinds: ['other'] },
  { name: 'Rad Power Bikes', domain: 'radpowerbikes.com', kinds: ['other'] },

  // Boats, caravans and machinery
  { name: 'Yamaha Marine', domain: 'yamahaoutboards.com', kinds: ['other'] },
  { name: 'Mercury Marine', domain: 'mercurymarine.com', kinds: ['other'] },
  { name: 'Sea-Doo', domain: 'sea-doo.brp.com', kinds: ['other'] },
  { name: 'Beneteau', domain: 'beneteau.com', kinds: ['other'] },
  { name: 'Jeanneau', domain: 'jeanneau.com', kinds: ['other'] },
  { name: 'Bayliner', domain: 'bayliner.com', kinds: ['other'] },
  { name: 'Boston Whaler', domain: 'bostonwhaler.com', kinds: ['other'] },
  { name: 'Zodiac', domain: 'zodiac-nautic.com', kinds: ['other'] },
  { name: 'Airstream', domain: 'airstream.com', kinds: ['other'] },
  { name: 'Winnebago', domain: 'winnebago.com', kinds: ['other'] },
  { name: 'Hymer', domain: 'hymer.com', kinds: ['other'] },
  { name: 'Fendt', domain: 'fendt.com', kinds: ['other'] },
  { name: 'John Deere', domain: 'deere.com', kinds: ['other'] },
  { name: 'Kubota', domain: 'kubota.com', kinds: ['other'] },
  { name: 'New Holland', domain: 'newholland.com', kinds: ['other'] },
  { name: 'Massey Ferguson', domain: 'masseyferguson.com', kinds: ['other'] },
  { name: 'Caterpillar', domain: 'cat.com', kinds: ['other'] },
  { name: 'JCB', domain: 'jcb.com', kinds: ['other'] },
  { name: 'Bobcat', domain: 'bobcat.com', kinds: ['other'] },
];

/** Lowercased name to entry, so a stored make resolves to a domain without a scan. */
const BY_NAME = new Map(VEHICLE_MAKES.map((make) => [make.name.toLowerCase(), make]));

/**
 * The domain for a make, if it is one we know.
 *
 * Matched case-insensitively on the whole name — not fuzzily. A near match would put
 * Mercury Marine's logo on a Mercury car, which is a different company.
 */
export function domainForMake(make: string | null | undefined): string | null {
  if (!make) return null;
  return BY_NAME.get(make.trim().toLowerCase())?.domain ?? null;
}

/**
 * Which makes to offer for a vehicle type.
 *
 * A motorcycle owner should not scroll past two hundred car marques, and the type is already
 * answered by the time the make is asked.
 */
export function makesForKind(kind: MakeKind): VehicleMake[] {
  return VEHICLE_MAKES.filter((make) => make.kinds.includes(kind));
}

/**
 * The type a make answers on its own: a maker of only cars, or only motorcycles. One that builds
 * both, or anything else, leaves the question open.
 */
export function typeForMake(make: string | null | undefined): 'CAR' | 'MOTORCYCLE' | null {
  const kinds = make ? BY_NAME.get(make.trim().toLowerCase())?.kinds : undefined;
  if (kinds?.length !== 1) return null;
  return kinds[0] === 'car' ? 'CAR' : kinds[0] === 'moto' ? 'MOTORCYCLE' : null;
}

/**
 * Which slice of the make list a vehicle type draws from. Vans and RVs are built by car makers,
 * ATVs by motorcycle makers, so they borrow those lists rather than keep their own.
 */
export function makeKindFor(type: string): MakeKind {
  switch (type) {
    case 'MOTORCYCLE':
    case 'SCOOTER':
    case 'ATV':
      return 'moto';
    case 'BICYCLE':
    case 'BOAT':
    case 'TRAILER':
      return 'other';
    default:
      return 'car';
  }
}
