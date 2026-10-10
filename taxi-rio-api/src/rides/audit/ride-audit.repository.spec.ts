import { RideStatus } from '../domain/ride-status';
import type { RideAuditRecord } from '../events/ride-audit-event';
import { MongodbService } from '../../mongodb/mongodb.service';
import { RideAuditRepository } from './ride-audit.repository';

describe('RideAuditRepository', () => {
  const collection = {
    createIndex: jest.fn(),
    insertOne: jest.fn<Promise<unknown>, [RideAuditRecord]>(),
    updateOne: jest.fn<
      Promise<{ matchedCount: number }>,
      [Record<string, unknown>, Record<string, unknown>]
    >(),
  };
  let repository: RideAuditRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    collection.insertOne.mockResolvedValue({ acknowledged: true });
    collection.updateOne.mockResolvedValue({ matchedCount: 1 });
    repository = new RideAuditRepository({
      collection: () => collection,
    } as unknown as MongodbService);
  });

  it('inserts a new audit record', async () => {
    await repository.insert(record());
    expect(collection.insertOne).toHaveBeenCalledWith(record());
  });

  it('treats a duplicate create as already processed', async () => {
    collection.insertOne
      .mockResolvedValueOnce({ acknowledged: true })
      .mockRejectedValueOnce(duplicateKey());

    await repository.insert(record());
    await expect(repository.insert(record())).resolves.toBeUndefined();
  });

  it('propagates unrelated insert failures', async () => {
    collection.insertOne.mockRejectedValue(new Error('connection reset'));

    await expect(repository.insert(record())).rejects.toThrow(
      'connection reset',
    );
  });

  it('updates status when the document exists', async () => {
    await repository.updateStatus(
      record({ status_corrida: RideStatus.Initialized }),
    );

    expect(collection.updateOne).toHaveBeenCalledWith(
      { id_corrida: '11111111-1111-4111-8111-111111111111' },
      { $set: { status_corrida: RideStatus.Initialized } },
    );
  });

  it('fails when a status event arrives before the matching create', async () => {
    collection.updateOne.mockResolvedValue({ matchedCount: 0 });

    await expect(
      repository.updateStatus(
        record({ status_corrida: RideStatus.Initialized }),
      ),
    ).rejects.toThrow(
      'Ride audit 11111111-1111-4111-8111-111111111111 was not found',
    );
    expect(collection.insertOne).not.toHaveBeenCalled();
  });

  it('applies the same status update twice without error', async () => {
    await repository.updateStatus(
      record({ status_corrida: RideStatus.Initialized }),
    );
    await expect(
      repository.updateStatus(
        record({ status_corrida: RideStatus.Initialized }),
      ),
    ).resolves.toBeUndefined();
    expect(collection.updateOne).toHaveBeenCalledTimes(2);
  });
});

function duplicateKey(): Error {
  return Object.assign(new Error('E11000 duplicate key error'), {
    code: 11000,
  });
}

function record(overrides?: Partial<RideAuditRecord>): RideAuditRecord {
  return {
    id_corrida: '11111111-1111-4111-8111-111111111111',
    status_corrida: RideStatus.Requested,
    dh_inicio: new Date('2026-10-07T18:00:00.000Z'),
    dh_fim: null,
    computed_elapsed_time: null,
    ...overrides,
  };
}
