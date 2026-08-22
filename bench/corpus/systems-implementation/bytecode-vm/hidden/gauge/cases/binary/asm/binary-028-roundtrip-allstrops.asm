; case binary-028-roundtrip-allstrops
; expect exit=0 stdout=""
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_STR " world"
  CONCAT
  PUSH_INT 0
  PUSH_INT 5
  SUBSTR
  PUSH_STR "ll"
  INDEXOF
  TOSTR
  TOINT
  PUSH_INT 65
  CHR
  ORD
  ADD
  TYPEOF
  PRINT
  RET
.end
