import PillarColumn from './PillarColumn';
import VolatilityAccelerationTable from './tables/VolatilityAccelerationTable';
import GammaFlipProximityTable from './tables/GammaFlipProximityTable';
import WallBreakersTable from './tables/WallBreakersTable';
import VannaCharmSqueezeTable from './tables/VannaCharmSqueezeTable';
import RichVrpTable from './tables/RichVrpTable';
import ExtremeSkewTable from './tables/ExtremeSkewTable';
import SectorSkewDispersionTable from './tables/SectorSkewDispersionTable';
import TermStructureInversionTable from './tables/TermStructureInversionTable';
import NetPremiumInflowTable from './tables/NetPremiumInflowTable';
import DeltaWeightedFlowTable from './tables/DeltaWeightedFlowTable';
import UnusualVolumeOiTable from './tables/UnusualVolumeOiTable';

/** The "Top 10" Command Grid: three pillars, each grown past its original
 * two tables as new rankings became buildable from data already
 * computed/persisted elsewhere (Wall Breakers, Vanna/Charm Squeeze, Sector
 * Skew Dispersion, Term Structure Inversion, Delta-Weighted Flow) -- unlike
 * some other candidate tables considered (an options trade tape for
 * sweeps/blocks, VIX term structure) which would need a data source this
 * app doesn't have.
 * `data` is the GET /v1/options-command-center/ response body -- each
 * ranking list may legitimately be shorter than 10 rows, or empty, when
 * the persisted-snapshot universe doesn't have enough coverage yet (see
 * the backend endpoint's docstring). ScannerTable already renders a
 * "No matches right now" empty state, so no extra handling needed here. */
export default function CommandGrid({ data }) {
  return (
    <div className="mx-auto grid max-w-[1800px] grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-3">
      <PillarColumn title="Structural & Dealer Risk" icon="🎯">
        <VolatilityAccelerationTable rows={data?.volatilityAcceleration} />
        <GammaFlipProximityTable rows={data?.gammaFlipProximity?.rows} widened={data?.gammaFlipProximity?.widened} />
        <WallBreakersTable rows={data?.wallBreakers} />
        <VannaCharmSqueezeTable rows={data?.vannaCharmSqueeze} />
      </PillarColumn>

      <PillarColumn title="Volatility Mispricing" icon="📈">
        <RichVrpTable rows={data?.richVrp} cheapRows={data?.cheapVrp} />
        <ExtremeSkewTable rows={data?.extremeSkew} />
        <SectorSkewDispersionTable rows={data?.sectorSkewDispersion} />
        <TermStructureInversionTable rows={data?.termStructureInversion} />
      </PillarColumn>

      <PillarColumn title="Smart Money Flow" icon="💰">
        <NetPremiumInflowTable rows={data?.netPremiumInflows} />
        <DeltaWeightedFlowTable rows={data?.deltaWeightedFlow} />
        <UnusualVolumeOiTable rows={data?.unusualVolumeOi} />
      </PillarColumn>
    </div>
  );
}
