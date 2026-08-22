; case compare-125-gtstr
; expect exit=0 stdout="false\n"
.func main arity=0 locals=0
  PUSH_STR "a"
  PUSH_STR "b"
  GT
  PRINT
  RET
.end
