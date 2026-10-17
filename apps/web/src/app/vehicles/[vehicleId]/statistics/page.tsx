'use client';

import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { isReportPeriod, type ReportPeriod } from '@vehicle-os/ui';
import { EmptyState } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { PrintHeading } from '@/components/print-report';
import {
  isReportTab,
  REPORT_TABS,
  useVehicleReport,
  type ReportTab,
} from '@/components/vehicle/report-data';
import {
  GroupTab,
  IncomeTab,
  OverviewTab,
  RefuelingTab,
  ReportNav,
  RoutesTab,
} from '@/components/vehicle/report-tabs';

/**
 * The vehicle's report: what it costs, what it burns, what it earns and where it goes.
 *
 * Six tabs over one period — Overview, then each part of the money (Refueling, Expenses,
 * Services), what it earns (Income) and where it went (Routes). The spend tabs are slices of one
 * ledger, so they always add up to the overview; the period applies to all of them at once, so
 * moving between tabs compares like with like.
 *
 * Tab and period live in the URL: a report is a link, and the back button walks back through it.
 */
export default function StatisticsPage() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabParam = search.get('tab');
  const periodParam = search.get('period');
  const tab: ReportTab = isReportTab(tabParam) ? tabParam : 'overview';
  const period: ReportPeriod = isReportPeriod(periodParam) ? periodParam : '1y';

  const report = useVehicleReport(vehicleId, period);

  const go = (next: { tab?: ReportTab; period?: ReportPeriod }) => {
    const params = new URLSearchParams(search);
    if (next.tab) params.set('tab', next.tab);
    if (next.period) params.set('period', next.period);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const label = REPORT_TABS.find((entry) => entry.value === tab)!.label;

  return (
    <div className="flex flex-col gap-4">
      <PrintHeading
        title={`Vehicle report · ${label}`}
        subject={report.vehicle?.displayName}
        period={report.period.long}
      />

      <ReportNav
        period={period}
        onPeriod={(next) => go({ period: next })}
        refreshing={report.refreshing}
      />

      {report.error ? (
        <EmptyState title="Could not load the report" description={report.error.message} />
      ) : (
        // The last window's figures stay up, dimmed, while the next one loads over them.
        <section
          key={tab}
          aria-label={label}
          aria-busy={report.refreshing}
          className={cn('animate-rise transition-opacity', report.refreshing && 'opacity-50')}
        >
          {tab === 'overview' ? (
            <OverviewTab report={report} onTab={(next) => go({ tab: next })} />
          ) : tab === 'refueling' ? (
            <RefuelingTab report={report} />
          ) : tab === 'expenses' ? (
            <GroupTab report={report} group="EXPENSES" />
          ) : tab === 'services' ? (
            <GroupTab report={report} group="SERVICES" />
          ) : tab === 'income' ? (
            <IncomeTab report={report} />
          ) : (
            <RoutesTab report={report} />
          )}
        </section>
      )}
    </div>
  );
}
