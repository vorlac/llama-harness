; case strops-036-indexof
; expect exit=0 stdout="-1\n"
.func main arity=0 locals=0
  PUSH_STR "hello"
  PUSH_STR "z"
  INDEXOF
  PRINT
  RET
.end
