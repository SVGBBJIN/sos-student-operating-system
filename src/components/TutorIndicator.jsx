export default function TutorIndicator({ active }) {
  return (
    <div
      className={'tutor-indicator' + (active ? ' active' : '')}
      title={active ? 'Tutor mode is ON' : 'Tutor mode is OFF'}
    >
      ✦ Tutor {active ? 'ON' : 'OFF'}
    </div>
  );
}
