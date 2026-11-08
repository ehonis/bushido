/*
 * The two things every list screen opens with (#98, G r1 F5/F6).
 *
 * `ScreenTitle`: Today, Log and Progress are each titled at screen size (24),
 * as the contract lists them; Today's title is its day switcher.
 *
 * `SubFilter`: a second level of filter, inside the activity picked (the
 * plan's categories under Climbing: Fingers, Endurance, Fun). Said as one: a
 * caption that names what it narrows, indented behind a rule, its chips
 * outlined rather than filled, so "Endurance" never reads as another sport
 * beside Bike and Swim. The chips keep their class (`filters …`) and 44px.
 * The phone's are features/filters.tsx.
 */

export function ScreenTitle({ children }) {
  return <h2 className="screen-title">{children}</h2>
}

/** "Kind of climbing": what the second row narrows, from the activity's name. */
export const subFilterLabel = (activityName) => (activityName ? `Kind of ${activityName.toLowerCase()}` : 'Kind')

export function SubFilter({ label, className = '', children }) {
  return (
    <div className="subfilter">
      <span className="subfilter-label" aria-hidden="true">{label}</span>
      <div className={`filters ${className}`} role="group" aria-label={label}>{children}</div>
    </div>
  )
}
