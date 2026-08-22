; Two arrays that reference each other, then are dropped. A mark-and-sweep
; collector reports 0 live objects at the end; a reference counter reports 2.
.func main arity=0 locals=2
  NEW_ARRAY 0
  STORE_LOCAL 0
  NEW_ARRAY 0
  STORE_LOCAL 1
  LOAD_LOCAL 0
  LOAD_LOCAL 1
  ARR_PUSH
  LOAD_LOCAL 1
  LOAD_LOCAL 0
  ARR_PUSH
  GCLIVE
  PRINT
  PUSH_NIL
  STORE_LOCAL 0
  PUSH_NIL
  STORE_LOCAL 1
  GCLIVE
  PRINT
  RET
.end
