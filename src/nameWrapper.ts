// Import types and APIs from graph-ts
import {
  Bytes, store, BigInt, log, ByteArray
} from '@graphprotocol/graph-ts'
// Import event types from the registry contract ABI
import {
  FusesSet as FusesSetEvent, NameUnwrapped as NameUnwrappedEvent, NameWrapped as NameWrappedEvent, TransferBatch as TransferBatchEvent, TransferSingle as TransferSingleEvent
} from './types/NameWrapper/NameWrapper'
// Import entity types generated from the GraphQL schema
import { Domain, FusesSet, NameUnwrapped, NameWrapped, WrappedDomain, WrappedTransfer } from './types/schema'
import { concat, createEventID, createOrLoadAccount, createOrLoadDomain } from './utils'

function decodeName (buf:Bytes):Array<string> {
  log.debug('handleNameWrappedParams decodeName, {}', [buf.toHexString()])
  let offset = 0
  let list = new ByteArray(0);
  let dot = Bytes.fromHexString('2e')
  let len = buf[offset++]
  let hex = buf.toHexString()
  let firstLabel = ''
  log.debug('decodeName len', [len.toString()])
  if (len === 0) {
    return [firstLabel, '.']
  }

  while (len) {
    log.debug('decodeName while, {}', [len.toString()])
    let label = hex.slice((offset +1 ) * 2, (offset + 1 + len ) * 2)
    let labelBytes = Bytes.fromHexString(label)
  
    log.debug('decodeName while label, {}', [label])
    if(offset > 1){
      list = concat(list, dot)
    }else{
      firstLabel = labelBytes.toString()
    }
    log.debug('decodeName while labelBytes, {}', [labelBytes.toString()])
    list = concat(list, labelBytes)
    offset += len
    len = buf[offset++]
    log.debug('decodeName while len, {}', [len.toString()])
  }
  log.debug('decodeName list {}, {}', [firstLabel, list.toString()])
  return [firstLabel, list.toString()]
}

function decodeNameNew(buf:Bytes):Array<string> {
  log.debug('handleNameWrappedParams decodeNameNew, {}', [buf.toString()])
  const splitted =  buf.toString().split(' ')
  if (splitted.length === 2) {
    return [splitted[0], splitted[1]]
  }
  const splitted2 = buf.toString().split('.')
  if (splitted2.length === 2) {
    return [splitted2[0], splitted2[1]]
  }
  return ['unknown','unknown']
}




export function handleNameWrapped(event: NameWrappedEvent): void {
  log.debug('handleNameWrappedParams {}', [event.params.name.toHexString()])
  let decoded = decodeNameNew(event.params.name)
  let label = decoded[0]
  let name = decoded[1]
  log.debug('handleNameWrappedDecoded', [])
  log.debug('handleNameWrappedDecoded values: {} , {}', [decoded[0], decoded[1]])
  
  let node = event.params.node
  let fuses = event.params.fuses
  let blockNumber = event.block.number.toI32()
  let transactionID = event.transaction.hash
  log.debug('befor account create or load', [])
  
  let owner = createOrLoadAccount(event.params.owner.toHex())
  let domain = createOrLoadDomain(node.toHex())

  if(!domain.labelName){
    domain.labelName = label
    domain.name = name
  }
  domain.save()

  let wrappedDomain = new WrappedDomain(node.toHex())
  wrappedDomain.domain = domain.id
  wrappedDomain.expiryDate = event.params.expiry
  wrappedDomain.fuses = fuses
  wrappedDomain.owner = owner.id
  wrappedDomain.labelName = name
  wrappedDomain.save()

  let nameWrappedEvent = new NameWrapped(createEventID(event))  
  nameWrappedEvent.domain = domain.id
  nameWrappedEvent.name = name
  nameWrappedEvent.fuses = fuses
  nameWrappedEvent.owner = owner.id
  nameWrappedEvent.blockNumber = blockNumber
  nameWrappedEvent.transactionID = transactionID
  nameWrappedEvent.save()
}

export function handleNameUnwrapped(event: NameUnwrappedEvent): void {
  let node = event.params.node
  let blockNumber = event.block.number.toI32()
  let transactionID = event.transaction.hash
  let owner = createOrLoadAccount(event.params.owner.toHex())

  let nameUnwrappedEvent = new NameUnwrapped(createEventID(event))  
  nameUnwrappedEvent.domain = node.toHex()
  nameUnwrappedEvent.owner = owner.id
  nameUnwrappedEvent.blockNumber = blockNumber
  nameUnwrappedEvent.transactionID = transactionID
  nameUnwrappedEvent.save()

  store.remove('WrappedDomain', node.toHex())
}

export function handleFusesSet(event: FusesSetEvent): void {
  let node = event.params.node
  let fuses = event.params.fuses
  let expiry = event.params.expiry
  let blockNumber = event.block.number.toI32()
  let transactionID = event.transaction.hash
  let wrappedDomain = WrappedDomain.load(node.toHex())!
  wrappedDomain.fuses = fuses
  wrappedDomain.expiryDate = expiry
  wrappedDomain.save()
  let fusesBurnedEvent = new FusesSet(createEventID(event))  
  fusesBurnedEvent.domain = node.toHex()
  fusesBurnedEvent.fuses = fuses
  fusesBurnedEvent.blockNumber = blockNumber
  fusesBurnedEvent.transactionID = transactionID
  fusesBurnedEvent.save()
}

function makeWrappedTransfer(blockNumber: i32, transactionID: Bytes, eventID: string, node: BigInt, to: string): void {
  const _to = createOrLoadAccount(to)
  const namehash = '0x' + node.toHex().slice(2).padStart(64, '0')
  const domain = createOrLoadDomain(namehash)
  let wrappedDomain = WrappedDomain.load(namehash)
  // new registrations emit the Transfer` event before the NameWrapped event
  // so we need to create the WrappedDomain entity here
  if (wrappedDomain == null) {
    wrappedDomain = new WrappedDomain(namehash)
  }
  wrappedDomain.owner = _to.id
  wrappedDomain.save()
  const wrappedTransfer = new WrappedTransfer(eventID)
  wrappedTransfer.domain = domain.id
  wrappedTransfer.blockNumber = blockNumber
  wrappedTransfer.transactionID = transactionID
  wrappedTransfer.owner = _to.id
  wrappedTransfer.save()
}

export function handleTransferSingle(event: TransferSingleEvent): void {
  makeWrappedTransfer(event.block.number.toI32(), event.transaction.hash, createEventID(event).concat('-0'), event.params.id, event.params.to.toHex())
}

export function handleTransferBatch(event: TransferBatchEvent): void {
  let blockNumber = event.block.number.toI32()
  let transactionID = event.transaction.hash
  let ids = event.params.ids
  let to = event.params.to
  for (let i = 0; i < ids.length; i++) {
    makeWrappedTransfer(blockNumber, transactionID, createEventID(event).concat('-').concat(i.toString()), ids[i], to.toHex())
  }
}
