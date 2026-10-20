import prisma from '@/lib/prisma';

export type ExperimentResult = {
  variant: string;
  revision: string;
  lastExposureAt: string;
  exposures: number;
  signups: number;
  verifiedSignups: number;
  logins: number;
  dismissals: number;
  authSelected: number;
  engaged: number;
  gateShown: number;
};

/** A cohort is one anonymous exposure ID. Only 24-hour-old exposures are final. */
export async function getExperimentResults({
  websiteId,
  experiment,
  startDate,
  endDate,
}: {
  websiteId: string;
  experiment: string;
  startDate: Date;
  endDate: Date;
}): Promise<ExperimentResult[]> {
  const rows = await prisma.rawQuery(
    `
    with event_properties as (
      select
        e.event_id,
        e.event_name,
        e.created_at,
        max(d.string_value) filter (where d.data_key = 'experiment') as experiment,
        max(d.string_value) filter (where d.data_key = 'exposureId') as exposure_id,
        max(d.string_value) filter (where d.data_key = 'variant') as variant,
        max(d.string_value) filter (where d.data_key = 'revision') as revision,
        max(d.string_value) filter (where d.data_key = 'action') as action,
        max(d.string_value) filter (where d.data_key = 'accountId') as account_id
      from website_event e
      join event_data d on d.website_event_id = e.event_id
        and d.website_id = {{websiteId::uuid}}
        and d.data_key in ('experiment', 'exposureId', 'variant', 'revision', 'action', 'accountId')
      where e.website_id = {{websiteId::uuid}}
        and e.created_at between {{startDate}} and {{endDate}}
        and e.event_type = 2
        and e.event_name in (
          'experiment-exposure', 'experiment-conversion',
          'experiment-interaction', 'experiment-content-engaged'
        )
      group by e.event_id, e.event_name, e.created_at
    ),
    exposures as (
      select distinct on (exposure_id)
        exposure_id, variant, revision, created_at
      from event_properties
      where event_name = 'experiment-exposure'
        and experiment = {{experiment}}
        and exposure_id is not null
        and variant is not null
        and created_at <= {{matureBefore}}
      order by exposure_id, created_at
    ),
    opportunity as (
      select
        x.exposure_id, x.variant, x.revision, max(x.created_at) as created_at,
        bool_or(o.event_name = 'experiment-conversion' and o.action = 'signup') as signup,
        max(o.account_id) filter (where o.event_name = 'experiment-conversion' and o.action = 'signup') as account_id,
        bool_or(o.event_name = 'experiment-conversion' and o.action = 'login') as login,
        bool_or(o.event_name = 'experiment-interaction' and o.action = 'modal-dismiss') as dismissal,
        bool_or(o.event_name = 'experiment-interaction' and o.action = 'auth-selected') as auth_selected,
        bool_or(o.event_name = 'experiment-content-engaged') as engaged,
        bool_or(o.event_name = 'experiment-interaction' and o.action = 'gate-shown') as gate_shown
      from exposures x
      left join event_properties o on o.exposure_id = x.exposure_id
        and o.experiment = {{experiment}}
        and o.created_at >= x.created_at
        and o.created_at <= x.created_at + interval '24 hours'
      group by x.exposure_id, x.variant, x.revision
    ),
    verified_opportunity as (
      select o.*,
        exists (
          select 1 from server_event_fact f
          where f.website_id = {{websiteId::uuid}}
            and f.distinct_id = o.account_id
            and f.event_name = 'server.email-verified'
            and f.occurred_at >= o.created_at
            and f.occurred_at <= o.created_at + interval '24 hours'
        ) as verified
      from opportunity o
    )
    select
      variant, coalesce(revision, 'unknown') as revision,
      max(created_at) as "lastExposureAt",
      count(*) as exposures,
      count(*) filter (where signup) as signups,
      count(*) filter (where signup and verified) as "verifiedSignups",
      count(*) filter (where login) as logins,
      count(*) filter (where dismissal) as dismissals,
      count(*) filter (where auth_selected) as "authSelected",
      count(*) filter (where engaged) as engaged,
      count(*) filter (where gate_shown) as "gateShown"
    from verified_opportunity
    group by variant, revision
    order by "lastExposureAt" desc, variant
    `,
    {
      websiteId,
      experiment,
      startDate,
      endDate,
      matureBefore: new Date(endDate.getTime() - 24 * 60 * 60 * 1000),
    },
    'getExperimentResults',
  );
  return rows.map(row => ({
    variant: String(row.variant),
    revision: String(row.revision),
    lastExposureAt: String(row.lastExposureAt),
    exposures: Number(row.exposures),
    signups: Number(row.signups),
    verifiedSignups: Number(row.verifiedSignups),
    logins: Number(row.logins),
    dismissals: Number(row.dismissals),
    authSelected: Number(row.authSelected),
    engaged: Number(row.engaged),
    gateShown: Number(row.gateShown),
  }));
}
