const service = require('./admin.service');
function handle(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: { code: 'DUPLICATE', message: 'הרשומה כבר קיימת' } });
      throw error;
    }
  };
}
const page = (req, res) => res.render('staff/data', { title: 'ניהול משתמשים' });
const list = handle(async (req, res) => res.json(await service.list(req.params.resource, req.query)));
const get = handle(async (req, res) => res.json({ data: await service.get(req.params.resource, req.params.id) }));
const create = handle(async (req, res) => {
  const data = await service.create(req.params.resource, req.body);
  console.info(`[admin] created ${req.params.resource}/${data._id} by ${req.user._id}`);
  res.status(201).json({ data });
});
const update = handle(async (req, res) => {
  const data = await service.update(req.params.resource, req.params.id, req.body, req.user);
  console.info(`[admin] updated ${req.params.resource}/${req.params.id} by ${req.user._id}`);
  res.json({ data });
});
const remove = handle(async (req, res) => {
  await service.remove(req.params.resource, req.params.id, req.user);
  console.info(`[admin] deleted ${req.params.resource}/${req.params.id} by ${req.user._id}`);
  res.status(204).end();
});
module.exports = { page, list, get, create, update, remove };
