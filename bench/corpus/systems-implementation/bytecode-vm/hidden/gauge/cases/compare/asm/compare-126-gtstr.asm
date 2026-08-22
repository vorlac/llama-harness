; case compare-126-gtstr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "b"
  PUSH_STR "a"
  GT
  PRINT
  RET
.end
