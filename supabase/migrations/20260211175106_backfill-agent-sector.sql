-- Data fix: set agent team_id from manager when missing

update public.profiles as agent
set team_id = manager.team_id
from public.profiles as manager
where agent.role = 'AGENTE'
  and agent.manager_id is not null
  and agent.team_id is null
  and manager.id = agent.manager_id;