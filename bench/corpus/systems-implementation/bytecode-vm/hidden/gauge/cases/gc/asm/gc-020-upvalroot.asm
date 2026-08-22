; case gc-020-upvalroot
; expect exit=0 stdout="2\n0\n"
.func main arity=0 locals=1
  NEW_ARRAY 0
  STORE_LOCAL 0
  CLOSURE keeper
  STORE_GLOBAL k
  PUSH_NIL
  STORE_LOCAL 0
  GCLIVE
  PRINT
  PUSH_NIL
  STORE_GLOBAL k
  GCLIVE
  PRINT
  RET
.end
.func keeper arity=0 locals=0 upvals=1
  .upval local 0
  LOAD_UPVAL 0
  RET
.end
